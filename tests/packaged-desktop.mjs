import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { mkdtemp, realpath, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('signed bundle runs Git and MCP using only its own runtime and resources', { timeout: 30000 }, async t => {
  const app = fileURLToPath(new URL('../src-tauri/target/release/bundle/macos/Ordiff.app', import.meta.url));
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  const runtime = join(app, 'Contents/Resources/runtime');
  const node = join(app, 'Contents/MacOS/node');
  assert.equal(execFileSync(node, ['--version'], { encoding: 'utf8', timeout: 10000 }).trim(), 'v24.22.2');
  const dir = await mkdtemp(join(tmpdir(), 'ordiff-packaged-'));
  execFileSync('/usr/bin/git', ['-C', dir, 'init', '-q']);
  await writeFile(join(dir, '.git/info/exclude'), 'state/\n');
  await writeFile(join(dir, 'example.ts'), 'export const desktop = true;\n');
  const child = spawn(node, [join(runtime, 'server/desktop.js')], {
    cwd: dir, env: { PATH: '/usr/bin:/bin', ORDIFF_PORT: '0', ORDIFF_DATA_DIR: join(dir, 'state'), ORDIFF_UI_DIR: join(runtime, 'dist') },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await once(child, 'exit'); } await rm(dir, { recursive: true, force: true }); });
  let errors = '';
  child.stderr.on('data', data => { errors += data; });
  const lines = createInterface({ input: child.stdout });
  const line = await Promise.race([once(lines, 'line').then(([line]) => line), once(child, 'exit').then(() => { throw new Error(errors || 'Bundled backend exited before readiness.'); })]);
  const { url } = JSON.parse(line);
  assert.match(await (await fetch(url)).text(), /Ordiff/);
  const post = (path, body) => fetch(url + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post('/api/repository', { path: dir })).status, 200);
  const workspace = await (await fetch(url + '/api/workspace')).json();
  assert.equal(workspace.workspace.sections.length, 1);
  const config = workspace.mcpConfig.mcpServers.ordiff;
  assert.equal(config.command, node);
  assert.equal(config.args[0], join(runtime, 'server/mcp.js'));
  const mcp = spawn(config.command, config.args, { cwd: dir, env: { PATH: '/usr/bin:/bin', ...config.env }, stdio: ['pipe', 'pipe', 'inherit'] });
  t.after(() => mcp.kill());
  const replies = createInterface({ input: mcp.stdout });
  let id = 0;
  const rpc = async (method, params) => {
    const result = once(replies, 'line');
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) + '\n');
    const [line] = await result;
    const response = JSON.parse(line);
    assert.equal(response.error, undefined);
    return response.result;
  };
  await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'packaged-test', version: '1' } });
  mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const context = JSON.parse((await rpc('tools/call', { name: 'get_review_context', arguments: { includeDiff: true } })).content[0].text);
  assert.equal(context.sections[0].path, 'example.ts');
  const plan = await rpc('tools/call', { name: 'submit_review_plan', arguments: { version: context.version, groups: [{ title: 'Desktop integration', sections: [context.sections[0].id], explanations: { [context.sections[0].id]: 'Read the bundled backend result.' } }] } });
  assert.equal(plan.isError, undefined);
  assert.equal(JSON.parse(plan.content[0].text).behaviors, 1);
  const exited = once(child, 'exit');
  child.stdin.end();
  await exited;
  const unavailable = await rpc('tools/call', { name: 'get_review_context', arguments: {} });
  assert.equal(unavailable.isError, true);
  assert.match(unavailable.content[0].text, /Open Ordiff/);
  const checkout = await realpath(await mkdtemp(join(tmpdir(), 'ordiff-headless-')));
  t.after(() => rm(checkout, {recursive:true, force:true}));
  execFileSync('/usr/bin/git', ['-C', checkout, 'init', '-q']);
  await writeFile(join(checkout,'queued.ts'), 'export const queued = true;\n');
  const call = async (name, args) => {
    const result = await rpc('tools/call', {name, arguments:args});
    assert.ok(!result.isError, result.content[0].text);
    return JSON.parse(result.content[0].text);
  };
  const captured = await call('get_review_context', {repositoryPath:checkout, includeDiff:true});
  const submission = {captureRef:captured.captureRef,
    groups:[{title:'Offline review',sections:[captured.sections[0].id]}]};
  const delivered = await call('submit_review_plan', submission);
  assert.equal(delivered.status, 'queued');
  assert.equal((await call('submit_review_plan', submission)).receipt, delivered.receipt);
  const offlineFeedback = await rpc('tools/call', {name:'list_feedback_batches',arguments:{repositoryPath:checkout}});
  assert.equal(offlineFeedback.isError, true);
  await rm(checkout, {recursive:true});
  const reopened = spawn(node, [join(runtime, 'server/desktop.js')], {
    cwd:dir, env:{PATH:'/usr/bin:/bin', ORDIFF_PORT:new URL(url).port, ...config.env, ORDIFF_UI_DIR:join(runtime,'dist')},
    stdio:['pipe','pipe','inherit'],
  });
  t.after(async () => { if (reopened.exitCode === null) { reopened.stdin.end(); await once(reopened,'exit'); } });
  await once(createInterface({input:reopened.stdout}), 'line');
  const restored = await (await fetch(url + '/api/workspace')).json();
  assert.equal(restored.workspace.version, context.version);
  assert.ok(restored.repositories.find(r => r.path === checkout && r.unseen));
  const handoff = (await (await post('/api/repository', {path:checkout})).json()).workspace;
  assert.equal(handoff.version, captured.version);
  assert.equal(handoff.groups[0].title, 'Offline review');
  assert.ok(handoff.sections[0].lines.some(line => line.text.includes('queued = true')));
  assert.equal((await call('submit_review_plan', submission)).receipt, delivered.receipt);

});
