import { fileURLToPath } from 'node:url';
import { WorkspaceStore } from './workspace.js';
import { readPreviewFile, readMarkdownImage, extractWordText } from './files.js';
import { readDirectory } from './directories.js';

function reply(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(data));
}
async function readJson(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new Error('Use application/json for this request.');
  let body = '';
  for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 1024 * 1024) throw new Error('Request is too large.'); }
  try { return JSON.parse(body || '{}'); } catch { throw new Error('Request body is not valid JSON.'); }
}
export function createApi({ store = new WorkspaceStore(), defaultPath = process.cwd() } = {}) {
  const ready = store.restore();
  return async (request, response, next) => {
    if (!request.url?.startsWith('/api/')) { if (next) return next(); return reply(response, 404, { error: 'Not found.' }); }
    let url;
    try { url = new URL(request.url, `http://${request.headers.host}`); } catch { return reply(response, 400, { error: 'Invalid request host.' }); }
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return reply(response, 403, { error: 'Local requests only.' });
    if (request.headers.origin && request.headers.origin !== url.origin) return reply(response, 403, { error: 'Cross-origin access is not allowed.' });
    if (request.headers['sec-fetch-site'] === 'cross-site') return reply(response, 403, { error: 'Cross-origin access is not allowed.' });
    try {
      await ready;
      if (request.method === 'GET' && url.pathname === '/api/directories') {
        return reply(response, 200, await readDirectory(url.searchParams.get('path') || '~', url.searchParams.get('showHidden') === 'true'));
      }
      if (request.method === 'GET' && url.pathname === '/api/events') {
        if (response.destroyed) return;
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        const notify = revision => response.write(`data: ${JSON.stringify({ revision })}\n\n`);
        store.on('revision', notify);
        response.on('close', () => store.off('revision', notify));
        notify(store.revision);
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/file') {
        if (request.headers['sec-fetch-site'] === 'cross-site') return reply(response, 403, { error: 'Cross-origin access is not allowed.' });
        const resource = url.searchParams.get('resource');
        const read = resource === null ? readPreviewFile : readMarkdownImage;
        const file = await read(store.snapshot(), url.searchParams.get('sectionId'), url.searchParams.get('version'), url.searchParams.get('side') || 'after', resource);
        let bytes = file.bytes, mimeType = file.mimeType;
        if (url.searchParams.get('format') === 'text') {
          if (file.kind !== 'word-doc') return reply(response, 400, { error: 'Text extraction is only available for DOC files.' });
          bytes = Buffer.from(await extractWordText(bytes), 'utf8'); mimeType = 'text/plain; charset=utf-8';
        }
        response.writeHead(200, {
          'Content-Type': mimeType, 'Content-Length': bytes.length,
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name).replace(/'/g, '%27')}`,
          'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
          'Cross-Origin-Resource-Policy': 'same-origin', "Content-Security-Policy": "sandbox; default-src 'none'",
        });
        return response.end(bytes);
      }
      if (request.method === 'GET' && url.pathname === '/api/workspace') {
        if (url.searchParams.get('since') === String(store.revision)) return reply(response, 200, { revision: store.revision, unchanged: true });
        const mcpConfig = { mcpServers: { ordiff: { command: process.execPath, args: [fileURLToPath(new URL('./mcp.js', import.meta.url))], env: { ORDIFF_URL: url.origin } } } };
        return reply(response, 200, { revision: store.revision, workspace: store.snapshot(), recentRepositories: store.recentRepositories, defaultPath, mcpConfig });
      }
      if (request.method !== 'POST') return reply(response, 405, { error: 'Method not allowed.' });
      const body = await readJson(request);
      if (url.pathname === '/api/repository') await store.connect(body.path);
      else if (url.pathname === '/api/recent-repositories/remove') await store.removeRecentRepository(body.path);
      else if (url.pathname === '/api/disconnect') await store.disconnect();
      else if (url.pathname === '/api/refresh' || url.pathname === '/api/context') await store.refresh();
      else if (url.pathname === '/api/review-plan') {
        const { reviewPlanSchema } = await import('./schema.js');
        await store.submitPlan(reviewPlanSchema.parse(body));
      }
      else return reply(response, 404, { error: 'Not found.' });
      return reply(response, 200, { revision: store.revision, workspace: store.snapshot(), recentRepositories: store.recentRepositories });
    } catch (error) {
      const message = error.name === 'ZodError' ? 'The review plan is not valid. Check its groups, steps, and explanations.' : error.message;
      return reply(response, error.status || (/diff changed/.test(message) ? 409 : 400), { error: message });
    }
  };
}
