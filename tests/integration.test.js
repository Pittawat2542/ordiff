import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, realpath, symlink } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
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

test('directory browsing lists sorted folders and directory symlinks without files or workspace changes', async t => {
  const { path, url, store } = await setup(t);
  await mkdir(join(path, 'zebra'));
  await mkdir(join(path, 'alpha'));
  await mkdir(join(path, '.hidden'));
  await symlink(join(path, 'alpha'), join(path, 'linked'));
  await symlink(join(path, 'missing'), join(path, 'broken'));
  const response = await fetch(`${url}/api/directories?path=${encodeURIComponent(path)}`);
  assert.equal(response.status, 200);
  const listing = await response.json();
  assert.equal(listing.path, await realpath(path));
  assert.equal(listing.homePath, homedir());
  assert.deepEqual(listing.directories.map(dir => dir.name), ['alpha', 'linked', 'zebra']);
  assert.ok(listing.breadcrumbs.some(crumb => crumb.path === listing.parentPath));
  const hidden = await (await fetch(`${url}/api/directories?path=${encodeURIComponent(path)}&showHidden=true`)).json();
  assert.ok(hidden.directories.some(dir => dir.name === '.hidden'));
  assert.equal((await fetch(`${url}/api/directories?path=${encodeURIComponent(join(path, 'run.ts'))}`)).status, 400);
  assert.equal((await fetch(`${url}/api/directories?path=${encodeURIComponent(join(path, 'missing'))}`)).status, 400);
  assert.equal((await fetch(`${url}/api/directories?path=~`)).status, 200);
  assert.equal(store.snapshot(), null);
  assert.equal(store.revision, 0);
  assert.equal((await fetch(`${url}/api/directories`, { headers: { Origin: 'https://unrelated.example' } })).status, 403);
  assert.equal((await fetch(`${url}/api/directories`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
});

test('workspace responses publish recent history and removing entries changes only metadata', async t => {
  const { path, url, post } = await setup(t);
  const opened = await (await post('/api/repository', { path })).json();
  assert.deepEqual(opened.recentRepositories.map(repo => repo.path), [opened.workspace.repo.path]);
  const workspace = await (await fetch(url + '/api/workspace')).json();
  assert.deepEqual(workspace.recentRepositories, opened.recentRepositories);
  assert.equal((await post('/api/recent-repositories/remove', { path }, { Origin: 'https://unrelated.example' })).status, 403);
  const removed = await (await post('/api/recent-repositories/remove', { path: opened.workspace.repo.path })).json();
  assert.deepEqual(removed.recentRepositories, []);
  assert.equal(removed.workspace.repo.path, opened.workspace.repo.path);
  assert.equal(removed.revision, opened.revision + 1);
  assert.equal((await post('/api/recent-repositories/remove', {})).status, 400);
});

test('workspace events report revisions without rescanning Git and reject cross-site readers', async t => {
  const { path, url, post } = await setup(t);
  const abort = new AbortController();
  t.after(() => abort.abort());
  const response = await fetch(url + '/api/events', { signal: abort.signal });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.getReader();
  const read = async () => new TextDecoder().decode((await reader.read()).value);
  assert.match(await read(), /data: \{"revision":0,/);
  await post('/api/repository', { path });
  assert.match(await read(), /data: \{"revision":1,/);
  // A notification subscription must not make subsequent filesystem edits visible.
  await writeFile(join(path, 'extra.ts'), 'export const extra = true;\n');
  const snapshot = await (await fetch(url + '/api/workspace')).json();
  assert.equal(snapshot.revision, 1);
  assert.equal(snapshot.workspace.sections.length, 1);
  await post('/api/refresh');
  assert.match(await read(), /data: \{"revision":2,/);
  assert.equal((await fetch(url + '/api/events', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
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
  assert.deepEqual(tools.tools.map(tool => tool.name).sort(), ['get_feedback_batch', 'get_review_context', 'list_feedback_batches', 'report_feedback_outcomes', 'submit_review_plan']);
  const metadata = JSON.parse((await rpc('tools/call', { name: 'get_review_context', arguments: {} })).content[0].text);
  assert.equal(metadata.repo, store.snapshot().repo.path);
  assert.equal(metadata.groups, undefined);
  assert.equal(metadata.planStatus, undefined);
  assert.equal(metadata.sections[0].lines, undefined);
  assert.equal(metadata.sections[0].role, undefined);
  const contextResult = await rpc('tools/call', { name: 'get_review_context', arguments: { includeDiff: true } });
  assert.equal(contextResult.isError, undefined);
  const context = JSON.parse(contextResult.content[0].text);
  assert.ok(context.sections[0].lines.some(line => line.text.includes('failed')));
  const submitted = await rpc('tools/call', { name: 'submit_review_plan', arguments: { version: context.version, groups: [{ title: 'Expose failure', sections: [context.sections[0].id] }] } });
  assert.equal(submitted.isError, undefined);
  assert.equal(store.snapshot().groups[0].title, 'Expose failure');
  assert.equal(store.snapshot().groups[0].sections[0], context.sections[0].id);
  assert.equal(store.snapshot().groups[0].description, '');
  const detailed = await rpc('tools/call', { name: 'submit_review_plan', arguments: {
    version: context.version,
    groups: [{ title: 'Expose failure', description: 'Follow the contract.', sections: [context.sections[0].id], explanations: { [context.sections[0].id]: 'Start here.' } }],
  } });
  assert.equal(detailed.isError, undefined);
  const proposal=JSON.parse(detailed.content[0].text);
  assert.equal(proposal.status,'pending-human-acceptance');
  assert.equal(store.snapshot().groups[0].explanations[context.sections[0].id], undefined);
  const comment=await store.cycleAction('comment.create',{path:'run.ts',text:'Handle cancellation.',intent:'change',clientMutationId:'mcp-comment'});
  const batch=await store.cycleAction('batch.publish',{commentIds:[comment.id],clientMutationId:'mcp-publish'});
  const published=JSON.parse((await rpc('tools/call',{name:'get_feedback_batch',arguments:{batchId:batch.id}})).content[0].text);
  assert.equal(published.comments[0].text,'Handle cancellation.');
  await rpc('tools/call',{name:'report_feedback_outcomes',arguments:{batchId:batch.id,snapshotId:context.version,clientMutationId:'mcp-report',outcomes:[{commentId:comment.id,outcome:'addressed',explanation:'Handled cancellation.'}]}});
  assert.equal(store.snapshot().cycle.feedback.comments[0].status,'addressed');
  await writeFile(join(path,'run.ts'),'export const status = "updated";\n');
  const fresh=JSON.parse((await rpc('tools/call',{name:'get_review_context',arguments:{}})).content[0].text);
  assert.notEqual(fresh.version,context.version);assert.equal(store.snapshot().version,context.version);
  const withPlan = JSON.parse((await rpc('tools/call', { name: 'get_review_context', arguments: { includePlan: true, snapshotId:context.version } })).content[0].text);
  assert.equal(withPlan.groups[0].title, 'Expose failure');
  for (const sections of [['missing'], [context.sections[0].id, context.sections[0].id]]) {
    const rejected = await rpc('tools/call', { name: 'submit_review_plan', arguments: { version: context.version, groups: [{ title: 'Invalid', sections }] } });
    assert.equal(rejected.isError, true);
  }
  const stale = await rpc('tools/call', { name: 'submit_review_plan', arguments: { version: 'stale', groups: [{ title: 'Invalid', sections: [context.sections[0].id] }] } });
  assert.equal(stale.isError, true);
});
