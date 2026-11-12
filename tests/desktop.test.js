import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { runFile, stopProcesses } from '../server/processes.js';

async function launch(t, port = '0') {
  const dir = await mkdtemp(join(tmpdir(), 'ordiff-desktop-'));
  await mkdir(join(dir, 'ui'));
  await writeFile(join(dir, 'ui/index.html'), '<h1>Ordiff desktop</h1>');
  await writeFile(join(dir, 'secret'), 'private');
  const child = spawn(process.execPath, ['server/desktop.js'], {
    env: { ...process.env, ORDIFF_PORT: port, ORDIFF_DATA_DIR: join(dir, 'data'), ORDIFF_UI_DIR: join(dir, 'ui') },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '', errors = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { errors += chunk; });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await once(child, 'exit'); } await rm(dir, { recursive: true, force: true }); });
  await new Promise(resolve => {
    const timer = setTimeout(resolve, 5000);
    child.stdout.on('data', () => { if (output.includes('\n')) { clearTimeout(timer); resolve(); } });
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
  return { child, output, errors };
}

test('desktop backend serves production routes and exits when its parent pipe closes', async t => {
  const { child, output, errors } = await launch(t);
  assert.match(output, /"ready":true/, errors);
  const { url } = JSON.parse(output.trim());
  assert.match(await (await fetch(url + '/tools/text-diff')).text(), /Ordiff desktop/);
  assert.equal((await fetch(url + '/server/api.js')).status, 404);
  assert.equal((await fetch(url + '/%2e%2e%2fsecret')).status, 404);
  const workspace = await (await fetch(url + '/api/workspace')).json();
  assert.equal(workspace.workspace, null);
  assert.equal(workspace.mcpConfig.mcpServers.ordiff.env.ORDIFF_URL, url);
  const exited = once(child, 'exit');
  child.stdin.end();
  await exited;
  await assert.rejects(fetch(url + '/api/workspace'));
});

test('desktop backend fails clearly instead of connecting to a process occupying its port', async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { child, output, errors } = await launch(t, String(server.address().port));
  if (child.exitCode === null) await once(child, 'exit');
  assert.notEqual(child.exitCode, 0);
  assert.equal(output, '');
  assert.match(errors, /already in use/);
});

test('shutdown terminates an in-flight Git subprocess rather than leaving it behind', async () => {
  const pending = runFile(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {});
  stopProcesses();
  await assert.rejects(pending, error => error.killed && error.signal === 'SIGKILL');
});
