import { fileURLToPath } from 'node:url';
import { WorkspaceStore } from './workspace.js';
import { reviewPlanSchema } from './schema.js';

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
    try {
      await ready;
      if (request.method === 'GET' && url.pathname === '/api/workspace') {
        if (url.searchParams.get('since') === String(store.revision)) return reply(response, 200, { revision: store.revision, unchanged: true });
        const mcpConfig = { mcpServers: { ordiff: { command: process.execPath, args: [fileURLToPath(new URL('./mcp.js', import.meta.url))], env: { ORDIFF_URL: url.origin } } } };
        return reply(response, 200, { revision: store.revision, workspace: store.snapshot(), defaultPath, mcpConfig });
      }
      if (request.method !== 'POST') return reply(response, 405, { error: 'Method not allowed.' });
      const body = await readJson(request);
      if (url.pathname === '/api/repository') await store.connect(body.path);
      else if (url.pathname === '/api/disconnect') await store.disconnect();
      else if (url.pathname === '/api/refresh' || url.pathname === '/api/context') await store.refresh();
      else if (url.pathname === '/api/review-plan') await store.submitPlan(reviewPlanSchema.parse(body));
      else return reply(response, 404, { error: 'Not found.' });
      return reply(response, 200, { revision: store.revision, workspace: store.snapshot() });
    } catch (error) {
      const message = error.name === 'ZodError' ? 'The review plan is not valid. Check its groups, steps, and explanations.' : error.message;
      return reply(response, /diff changed/.test(message) ? 409 : 400, { error: message });
    }
  };
}
