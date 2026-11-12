import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';
import { runFile, stopProcesses } from '../server/processes.js';

async function launch(t, port = '0', traceImports = false) {
  const dir = await mkdtemp(join(tmpdir(), 'ordiff-desktop-'));
  await mkdir(join(dir, 'ui'));
  await writeFile(join(dir, 'ui/index.html'), '<h1>Ordiff desktop</h1>');
  await writeFile(join(dir, 'secret'), 'private');
  const imports = join(dir, 'imports.jsonl');
  const args = [];
  if (traceImports) {
    await writeFile(imports, '');
    const loader = join(dir, 'trace-imports.mjs');
    await writeFile(loader, `
      import { appendFile } from 'node:fs/promises';
      export async function resolve(specifier, context, next) {
        if (specifier === 'mdast-util-from-markdown' || specifier.startsWith('zod/'))
          await appendFile(${JSON.stringify(imports)}, JSON.stringify(specifier) + '\\n');
        return next(specifier, context);
      }
    `);
    args.push('--import', `data:text/javascript,${encodeURIComponent(`import { register } from 'node:module'; register(${JSON.stringify(pathToFileURL(loader).href)});`)}`);
  }
  const child = spawn(process.execPath, [...args, 'server/desktop.js'], {
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
  return { child, output, errors, imports };
}

test('desktop reaches the workspace without loading optional document and plan parsers', async t => {
  const { output, errors, imports } = await launch(t, '0', true);
  assert.match(output, /"ready":true/, errors);
  const { url } = JSON.parse(output.trim());
  assert.equal((await fetch(url)).status, 200);
  assert.equal((await (await fetch(url + '/api/workspace')).json()).workspace, null);
  assert.equal(await readFile(imports, 'utf8'), '', 'Optional parsers must stay off the startup path.');
  const invalidPlan = await fetch(url + '/api/review-plan', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(invalidPlan.status, 400);
  assert.match((await invalidPlan.json()).error, /review plan is not valid/);
  assert.deepEqual((await readFile(imports, 'utf8')).trim().split('\n').map(line => JSON.parse(line)), ['zod/v4']);
});

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
