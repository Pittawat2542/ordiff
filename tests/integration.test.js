import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createApi } from '../server/api.js';
import { WorkspaceStore } from '../server/workspace.js';

async function setup(t) {
  const path = await mkdtemp(join(tmpdir(), 'ordiff-api-'));
  execFileSync('git', ['-C', path, 'init', '-q']);
  await writeFile(join(path, 'run.ts'), 'export const status = "failed";\n');
  const store = new WorkspaceStore();
  const server = createServer(createApi({ store, defaultPath: path }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(path, { recursive: true, force: true }); });
  const post = (endpoint, body = {}, headers = {}) => fetch(url + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { path, store, url, post };
}

test('the app starts with no repository, connects a real Git diff, and disconnects back to onboarding', async t => {
  const { path, url, post } = await setup(t);
  assert.equal((await (await fetch(url + '/api/workspace')).json()).workspace, null);
  assert.equal((await post('/api/repository', { path })).status, 200);
  const connected = await (await fetch(url + '/api/workspace')).json();
  assert.equal(connected.workspace.repo.source, 'git');
  assert.equal(connected.workspace.sections.length, 1);
  assert.equal(connected.workspace.groups.length, 0);
  assert.equal((await (await fetch(url + '/api/workspace?since=' + connected.revision)).json()).unchanged, true);
  await post('/api/disconnect');
  assert.equal((await (await fetch(url + '/api/workspace')).json()).workspace, null);
});

test('cross-origin requests cannot select a directory or read a connected repository', async t => {
  const { path, url, store, post } = await setup(t);
  const denied = await post('/api/repository', { path }, { Origin: 'https://unrelated.example' });
  assert.equal(denied.status, 403);
  assert.equal(store.snapshot(), null);
  assert.equal((await fetch(url + '/api/workspace', { headers: { Origin: 'https://unrelated.example' } })).status, 403);
});

test('a real MCP stdio client can discover tools, read Git hunks, and send a plan to the same app', async t => {
  const { path, store, url, post } = await setup(t);
  await post('/api/repository', { path });
  const child = spawn(process.execPath, ['server/mcp.js'], { cwd: process.cwd(), env: { ...process.env, ORDIFF_URL: url }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { child.stdin.end(); child.kill(); });
  let sequence = 0;
  const pending = new Map();
  const reader = createInterface({ input: child.stdout });
  reader.on('line', line => {
    const message = JSON.parse(line);
    const entry = pending.get(message.id);
    if (entry) { clearTimeout(entry.timeout); pending.delete(message.id); message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result); }
  });
  const rpc = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`MCP request timed out: ${method}`)); }, 8000);
    pending.set(id, { resolve, reject, timeout });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'ordiff-test', version: '1' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const tools = await rpc('tools/list');
  assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ['get_review_context', 'submit_review_plan']);
  const contextResult = await rpc('tools/call', { name: 'get_review_context', arguments: { includeDiff: true } });
  assert.equal(contextResult.isError, undefined);
  const context = JSON.parse(contextResult.content[0].text);
  assert.ok(context.sections[0].lines.some(line => line.text.includes('failed')));
  const submitted = await rpc('tools/call', { name: 'submit_review_plan', arguments: { version: context.version, groups: [{ id: 'failure', title: 'Expose failure', description: 'Follow the contract.', steps: [{ sectionId: context.sections[0].id, explanation: 'Start at the new run state.' }] }] } });
  assert.equal(submitted.isError, undefined);
  assert.equal(store.snapshot().groups[0].title, 'Expose failure');
  assert.equal(store.snapshot().groups[0].sections[0], context.sections[0].id);
});
