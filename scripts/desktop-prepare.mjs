import { cp, mkdir, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Desktop packaging currently supports Apple Silicon macOS.');
const cache = join(root, '.desktop-cache');
const resources = join(root, 'src-tauri/resources');
const binaries = join(root, 'src-tauri/binaries');
const version = '24.22.2';
const archive = `node-v${version}-darwin-arm64.tar.gz`;
const sha256 = 'aa9549349e47dffaa42dcf95d6e06ade8c4bdafc980979883b88767670df385a';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}).`);
}
await mkdir(cache, { recursive: true });
await mkdir(binaries, { recursive: true });
const tarball = join(cache, archive);
let bytes;
try { bytes = await readFile(tarball); } catch { /* Download once, verify on every build. */ }
if (!bytes || digest(bytes) !== sha256) {
  console.log(`Downloading official Node ${version} for macOS ARM64…`);
  const response = await fetch(`https://nodejs.org/dist/v${version}/${archive}`, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`Node download failed: HTTP ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
  if (digest(bytes) !== sha256) throw new Error('Node runtime checksum mismatch.');
  await writeFile(tarball, bytes);
}
run('/usr/bin/tar', ['-xzf', tarball, '-C', cache]);
const nodeDir = join(cache, `node-v${version}-darwin-arm64`);
await cp(join(nodeDir, 'bin/node'), join(binaries, 'node-aarch64-apple-darwin'));
await chmod(join(binaries, 'node-aarch64-apple-darwin'), 0o755);
const lock = await readFile(join(root, 'package-lock.json'));
const locked = JSON.parse(lock);
const runtime = {
  name: 'ordiff-runtime', private: true, type: 'module',
  dependencies: Object.fromEntries(['@modelcontextprotocol/server', 'zod', 'word-extractor', 'mdast-util-from-markdown'].map(name => [name, locked.packages[`node_modules/${name}`].version])),
};
const dependencyHash = digest(Buffer.concat([lock, Buffer.from(JSON.stringify(runtime))]));
const deps = join(cache, 'dependencies');
let installed = '';
try { installed = await readFile(join(deps, '.lock-hash'), 'utf8'); } catch { /* First build. */ }
if (installed !== dependencyHash) {
  await mkdir(deps, { recursive: true });
  await cp(join(root, 'package.json'), join(deps, 'package.json'));
  await cp(join(root, 'package-lock.json'), join(deps, 'package-lock.json'));
  run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], deps);
  await writeFile(join(deps, 'package.json'), JSON.stringify(runtime));
  run('npm', ['prune', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], deps);
  await writeFile(join(deps, '.lock-hash'), dependencyHash);
}
await rm(resources, { recursive: true, force: true });
await mkdir(resources, { recursive: true });
await cp(join(root, 'dist'), join(resources, 'dist'), { recursive: true });
await cp(join(root, 'server'), join(resources, 'server'), { recursive: true });
await cp(join(root, 'shared'), join(resources, 'shared'), { recursive: true });
await cp(join(deps, 'node_modules'), join(resources, 'node_modules'), { recursive: true });
await cp(join(nodeDir, 'LICENSE'), join(resources, 'NODE-LICENSE'));
await writeFile(join(resources, 'package.json'), JSON.stringify({ name: 'ordiff-runtime', private: true, type: 'module' }));
console.log(`Prepared desktop resources in ${resolve(resources)}`);
