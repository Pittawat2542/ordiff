import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
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
  const plan = await rpc('tools/call', { name: 'submit_review_plan', arguments: { version: context.version, groups: [{ id: 'desktop', title: 'Desktop integration', description: '', steps: [{ sectionId: context.sections[0].id, explanation: 'Read the bundled backend result.' }] }] } });
  assert.equal(plan.isError, undefined);
  assert.equal(JSON.parse(plan.content[0].text).behaviors, 1);
  const exited = once(child, 'exit');
  child.stdin.end();
  await exited;
  const unavailable = await rpc('tools/call', { name: 'get_review_context', arguments: {} });
  assert.equal(unavailable.isError, true);
  assert.match(unavailable.content[0].text, /Open Ordiff/);
});
