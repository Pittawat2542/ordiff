import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { createApi } from './api.js';
import { WorkspaceStore } from './workspace.js';
import { stopProcesses } from './processes.js';

const root = resolve(process.env.ORDIFF_UI_DIR || fileURLToPath(new URL('../dist', import.meta.url)));
const data = process.env.ORDIFF_DATA_DIR || resolve(homedir(), 'Library/Application Support/Ordiff');
const api = createApi({ store: new WorkspaceStore({ stateFile: resolve(data, 'workspace.json') }), defaultPath: homedir() });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.wasm': 'application/wasm', '.bcmap': 'application/octet-stream' };
const server = createServer((request, response) => {
  void api(request, response, async () => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
      const url = new URL(request.url, 'http://127.0.0.1');
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(`http://${request.headers.host}`).hostname)) { response.writeHead(403).end(); return; }
      const path = decodeURIComponent(url.pathname);
      const filename = path === '/' || path === '/tools/text-diff' ? resolve(root, 'index.html') : resolve(root, `.${path}`);
      if (!filename.startsWith(root + sep)) { response.writeHead(404).end(); return; }
      if (!(await stat(filename)).isFile()) { response.writeHead(404).end(); return; }
      const bytes = await readFile(filename);
      response.writeHead(200, {
        'Content-Type': types[extname(filename)] || 'application/octet-stream',
        'Content-Length': bytes.length, 'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache', 'Cross-Origin-Resource-Policy': 'same-origin',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; worker-src 'self' blob:; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'",
      });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch { if (!response.headersSent) response.writeHead(404); response.end(); }
  });
});
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  stopProcesses();
  server.closeAllConnections();
  server.close(() => process.exit(0));
}
process.stdin.resume();
process.stdin.on('end', stop);
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? 'Ordiff could not start: port 47831 is already in use. Quit the other process and reopen Ordiff.' : `Ordiff could not start: ${error.message}`);
  process.exit(1);
});
server.listen(Number(process.env.ORDIFF_PORT ?? 47831), '127.0.0.1', () => {
  process.stdout.write(JSON.stringify({ ready: true, url: `http://127.0.0.1:${server.address().port}` }) + '\n');
});
