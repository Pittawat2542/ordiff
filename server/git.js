import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath, lstat, readFile, readlink, open } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import { describeFile, fileFormat } from './files.js';

const exec = promisify(execFile);
export const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
async function git(path, args) {
  return (await exec('git', ['--no-pager', '-c', 'core.quotePath=false', '-C', path, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 15000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } })).stdout;
}

function category(path) {
  if (/(^|\/)(test[s]?|__tests__)(\/|$)|\.(test|spec)\./i.test(path)) return ['Tests', /tsx|jsx/.test(path) ? 'TSX' : 'TypeScript'];
  if (/\.(md|mdx|rst|txt)$/i.test(path)) return ['Docs', 'Markdown'];
  if (/(^|\/)server\//.test(path)) return ['Backend', 'JavaScript'];
  if (/(^|\/)pipeline\//.test(path)) return ['Pipeline', 'JavaScript'];
  if (/\.(jsx|tsx|html|css)$|src\/main\./.test(path)) return ['UI', /tsx|jsx/.test(path) ? 'TSX' : path.endsWith('.css') ? 'CSS' : 'JavaScript'];
  if (/\.(json|ya?ml|toml)$|(^|\/)\./.test(path)) return ['Config', 'Configuration'];
  return ['Code', 'Code'];
}
function section(path, header, lines, extra = {}) {
  const [role, language] = category(path);
  return { id: `hunk-${hash(JSON.stringify([path, header, lines]))}`, path, role, language, group: null, symbol: header, title: header.startsWith('@@') ? header.replace(/^@@.*?@@\s*/, '') || 'Changed section' : header, explanation: '', checklist: [], lines, ...extra };
}
function parsePatch(path, patch) {
  const result = [];
  let current, oldLine, newLine;
  for (const row of patch.split('\n')) {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(row);
    if (match) { oldLine = Number(match[1]); newLine = Number(match[2]); current = { header: row, lines: [] }; result.push(current); }
    else if (current && [' ', '-', '+'].includes(row[0])) {
      const type = row[0] === '+' ? 'add' : row[0] === '-' ? 'remove' : 'context';
      current.lines.push({ type, text: row.slice(1), old: type === 'add' ? null : oldLine++, new: type === 'remove' ? null : newLine++, extra: false });
    }
  }
  if (result.length) return result.map(item => section(path, item.header, item.lines));
  if (patch.trim()) {
    const binary = /Binary files|GIT binary patch/.test(patch);
    const detail = binary ? 'Binary file changed.' : patch.split('\n').filter(row => /mode |rename |similarity /.test(row)).join('\n') || 'File metadata changed.';
    return [section(path, binary ? 'Binary file changed' : 'File metadata changed', [{ type: 'context', text: detail, old: null, new: null }], { binary })];
  }
  return [];
}
async function addedFile(root, path) {
  const filename = join(root, path);
  const stat = await lstat(filename);
  if (stat.isSymbolicLink()) return [section(path, 'New symbolic link', [{ type: 'add', text: await readlink(filename), old: null, new: 1 }])];
  if (!stat.isFile()) return [];
  const handle = await open(filename, 'r');
  let binary;
  try { const sample = Buffer.alloc(8192); const { bytesRead } = await handle.read(sample, 0, sample.length, 0); binary = sample.subarray(0, bytesRead).includes(0); }
  finally { await handle.close(); }
  if (binary || stat.size > 2 * 1024 * 1024) return [section(path, binary ? 'New binary file' : 'Large file', [{ type: 'context', text: `${binary ? 'Binary file' : 'Text preview omitted: larger than 2 MiB'} (${stat.size.toLocaleString()} bytes).`, old: null, new: null }], { binary: true })];
  const rows = (await readFile(filename, 'utf8')).split('\n');
  if (rows.at(-1) === '') rows.pop();
  const lines = rows.map((text, index) => ({ type: 'add', text, old: null, new: index + 1, extra: false }));
  return [section(path, `New file · ${lines.length} ${lines.length === 1 ? 'line' : 'lines'}`, lines.length ? lines : [{ type: 'context', text: 'Empty file added.', old: null, new: null }])];
}
export async function readRepository(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Enter a local Git repository directory.');
  let root;
  try { const directory = await realpath(input); root = (await git(directory, ['rev-parse', '--show-toplevel'])).trim(); }
  catch { throw new Error('This directory is not an accessible Git repository. Check the path and try again.'); }
  let head = '';
  try { head = (await git(root, ['rev-parse', '--verify', 'HEAD'])).trim(); } catch { /* New repositories have no HEAD. */ }
  const branch = (await git(root, ['symbolic-ref', '--short', '-q', 'HEAD']).catch(() => '')).trim() || (head ? `Detached ${head.slice(0, 7)}` : 'New branch');
  const untracked = (await git(root, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean);
  const tracked = (await git(root, head ? ['diff', '--name-only', '--no-renames', '-z', 'HEAD', '--'] : ['ls-files', '-z'])).split('\0').filter(Boolean);
  const paths = [...new Set([...tracked, ...untracked])].sort();
  if (paths.length > 500) throw new Error('This working tree has more than 500 changed files. Narrow the changes before opening it in Ordiff.');
  const sections = [];
  for (const path of paths) {
    if (!head || untracked.includes(path)) { try { sections.push(...await addedFile(root, path)); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    else sections.push(...parsePatch(path, await git(root, ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--unified=3', 'HEAD', '--', path])));
  }
  const previews = new Map();
  for (const item of sections) {
    if (!item.binary && fileFormat(item.path).kind === 'unsupported') continue;
    if (!previews.has(item.path)) previews.set(item.path, await describeFile(root, item.path, head));
    const file = previews.get(item.path);
    if (file) {
      item.file = file;
      if (item.binary) item.id = `hunk-${hash(JSON.stringify([item.id, file.before?.hash, file.after?.hash]))}`;
    }
  }
  return { version: hash(JSON.stringify([root, head, sections.map(item => [item.id, item.file])])), repo: { path: root, name: basename(root), branch, hasHead: Boolean(head), source: 'git' }, sections, groups: [], planStatus: 'none' };
}
