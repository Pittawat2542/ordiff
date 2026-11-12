import { readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

export function expandHomePath(input) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Enter a local directory path.');
  const path = input.trim();
  return path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
}

export async function readDirectory(input = '~', showHidden = false) {
  let path, entries;
  try {
    path = await realpath(expandHomePath(input));
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    throw new Error('This folder is not accessible. Check the path or choose another folder.');
  }
  const directories = (await Promise.all(entries
    .filter(entry => showHidden || !entry.name.startsWith('.'))
    .map(async entry => {
      const child = join(path, entry.name);
      const directory = entry.isDirectory() || (entry.isSymbolicLink() && await stat(child).then(info => info.isDirectory(), () => false));
      return directory ? { name: entry.name, path: child } : null;
    }))).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const breadcrumbs = [];
  for (let part = path; ; part = dirname(part)) {
    breadcrumbs.unshift({ name: basename(part) || part, path: part });
    if (dirname(part) === part) break;
  }
  return { path, parentPath: dirname(path) === path ? null : dirname(path), homePath: homedir(), breadcrumbs, directories };
}
