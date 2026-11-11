import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createApi } from '../server/api.js';
import { WorkspaceStore } from '../server/workspace.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ordiff-preview-'));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.name', 'Ordiff Test');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  await writeFile(join(root, 'image.png'), Buffer.from([137, 80, 78, 71, 0, 1]));
  await writeFile(join(root, 'guide.md'), '# Original guide\n\nUnchanged context.\n');
  git('add', '.'); git('commit', '-qm', 'original files');
  await writeFile(join(root, 'image.png'), Buffer.from([137, 80, 78, 71, 0, 2]));
  await writeFile(join(root, 'guide.md'), '# Updated guide\n\nUnchanged context.\n');
  const store = new WorkspaceStore();
  await store.connect(root);
  const server = createServer(createApi({ store }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const file = (path, side = 'after', options = {}) => {
    const snapshot = store.snapshot();
    const section = snapshot.sections.find(item => item.path === path);
    return fetch(`${url}/api/file?${new URLSearchParams({ sectionId: section.id, version: snapshot.version, side })}`, options);
  };
  return { root, store, file, url, git };
}

test('previews expose original and working image bytes without changing Git files', async t => {
  const { root, store, file, git } = await fixture(t);
  const section = store.snapshot().sections.find(item => item.path === 'image.png');
  assert.ok(section.file, 'binary sections expose preview metadata');
  assert.equal(section.file.kind, 'image');
  assert.equal(section.file.mimeType, 'image/png');
  const before = git('status', '--porcelain');
  const original = await file('image.png', 'before');
  assert.equal(original.status, 200);
  assert.deepEqual(Buffer.from(await original.arrayBuffer()), Buffer.from([137, 80, 78, 71, 0, 1]));
  const current = await file('image.png');
  assert.equal(current.status, 200);
  assert.equal(current.headers.get('content-type'), 'image/png');
  assert.match(current.headers.get('content-disposition'), /attachment/);
  assert.match(current.headers.get('content-security-policy'), /sandbox/);
  assert.deepEqual(Buffer.from(await current.arrayBuffer()), Buffer.from([137, 80, 78, 71, 0, 2]));
  assert.equal(git('status', '--porcelain'), before);
});

test('Markdown previews read the full file rather than only changed hunk lines', async t => {
  const { file } = await fixture(t);
  const response = await file('guide.md');
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '# Updated guide\n\nUnchanged context.\n');
});

test('same-size binary edits change the diff version and section identifier', async t => {
  const { root, store } = await fixture(t);
  const previous = store.snapshot();
  await writeFile(join(root, 'image.png'), Buffer.from([137, 80, 78, 71, 0, 3]));
  await store.refresh();
  assert.notEqual(store.snapshot().version, previous.version);
  assert.notEqual(store.snapshot().sections.find(item => item.path === 'image.png').id, previous.sections.find(item => item.path === 'image.png').id);
  await writeFile(join(root, 'new.png'), Buffer.from([0, 1, 2]));
  await store.refresh();
  const added = store.snapshot();
  await writeFile(join(root, 'new.png'), Buffer.from([0, 1, 3]));
  await store.refresh();
  assert.notEqual(store.snapshot().version, added.version);
});

test('preview requests reject stale bytes, stale versions, unknown sections, and cross-site access', async t => {
  const { root, store, file, url } = await fixture(t);
  const snap = store.snapshot();
  const section = snap.sections.find(item => item.path === 'image.png');
  const params = new URLSearchParams({ sectionId: section.id, version: snap.version, side: 'after' });
  assert.equal((await file('image.png', 'after', { headers: { Origin: 'https://unrelated.example' } })).status, 403);
  assert.equal((await file('image.png', 'after', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await fetch(`${url}/api/file?${new URLSearchParams({ ...Object.fromEntries(params), sectionId: '../../secret' })}`)).status, 404);
  assert.equal((await fetch(`${url}/api/file?${new URLSearchParams({ ...Object.fromEntries(params), version: 'stale' })}`)).status, 409);
  await writeFile(join(root, 'image.png'), Buffer.from([137, 80, 78, 71, 0, 9]));
  assert.equal((await file('image.png')).status, 409);
});

test('deleted files retain their original preview and symlink replacements are never followed', async t => {
  const { root, store, file } = await fixture(t);
  await rm(join(root, 'image.png'));
  await store.refresh();
  assert.equal((await file('image.png', 'before')).status, 200);
  assert.equal((await file('image.png')).status, 404);
  await writeFile(join(root, 'image.png'), Buffer.from([0, 2]));
  await store.refresh();
  await rm(join(root, 'image.png'));
  await symlink(join(root, 'guide.md'), join(root, 'image.png'));
  assert.equal((await file('image.png')).status, 403);
  await mkdir(join(root, 'nested'));
  await writeFile(join(root, 'nested/image.png'), Buffer.from([0, 3]));
  await store.refresh();
  await rm(join(root, 'nested'), { recursive: true });
  await symlink(tmpdir(), join(root, 'nested'));
  assert.equal((await file('nested/image.png')).status, 403);
});

test('Markdown can render referenced repository images without allowing arbitrary file access', async t => {
  const { root, store, file, url, git } = await fixture(t);
  await writeFile(join(root, 'unchanged.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><text>Original diagram</text></svg>');
  git('add', 'unchanged.svg'); git('commit', '-qm', 'diagram');
  await writeFile(join(root, 'guide.md'), '# Diagram\n\n![Diagram](unchanged.svg)\n');
  await store.refresh();
  const snapshot = store.snapshot(), section = snapshot.sections.find(s => s.path === 'guide.md');
  const request = resource => fetch(`${url}/api/file?${new URLSearchParams({ sectionId: section.id, version: snapshot.version, side: 'after', resource })}`);
  const image = await request('unchanged.svg');
  assert.equal(image.status, 200);
  assert.match(image.headers.get('content-type'), /image\/svg/);
  assert.match(await image.text(), /Original diagram/);
  assert.equal((await request('image.png')).status, 403);
  assert.equal((await request('../outside.png')).status, 403);
  assert.equal((await request('https://example.com/image.png')).status, 403);
  await writeFile(join(root, 'unchanged.svg'), '<svg>Changed diagram</svg>');
  assert.equal((await request('unchanged.svg')).status, 409);
});

test('DOC text is extracted locally and oversized previews have a clear limit', async t => {
  const { root, store, url } = await fixture(t);
  const doc = await readFile(new URL('../node_modules/mammoth/test/test-data/single-paragraph.docx', import.meta.url));
  await writeFile(join(root, 'document.doc'), doc);
  await writeFile(join(root, 'large.pdf'), Buffer.alloc(25 * 1024 * 1024 + 1));
  await store.refresh();
  const snapshot = store.snapshot();
  const get = (path, format) => fetch(`${url}/api/file?${new URLSearchParams({ sectionId: snapshot.sections.find(s => s.path === path).id, version: snapshot.version, side: 'after', ...(format ? { format } : {}) })}`);
  const response = await get('document.doc', 'text');
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'Walking on imported air\n');
  assert.equal((await get('guide.md', 'text')).status, 400);
  assert.equal((await get('large.pdf')).status, 413);
});
