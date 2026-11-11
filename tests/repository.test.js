import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readRepository } from '../server/git.js';
import { WorkspaceStore } from '../server/workspace.js';

function git(path, ...args) { return execFileSync('git', ['-C', path, ...args], { encoding: 'utf8' }).trim(); }

async function fixture(t, committed = true) {
  const path = await realpath(await mkdtemp(join(tmpdir(), 'ordiff-git-')));
  t.after(() => rm(path, { recursive: true, force: true }));
  git(path, 'init', '-q');
  git(path, 'config', 'user.email', 'test@example.invalid');
  git(path, 'config', 'user.name', 'Ordiff Test');
  git(path, 'config', 'commit.gpgsign', 'false');
  await writeFile(join(path, '.gitignore'), 'ignored.txt\n.ordiff/\n');
  await mkdir(join(path, 'pipeline'));
  await writeFile(join(path, 'pipeline/run.ts'), 'export const status = "running";\n');
  if (committed) { git(path, 'add', '.'); git(path, 'commit', '-qm', 'fixture'); }
  return path;
}

test('reads staged, unstaged, and untracked working changes without touching ignored files or the index', async t => {
  const path = await fixture(t);
  await writeFile(join(path, 'pipeline/run.ts'), 'export const status = "failed";\n');
  git(path, 'add', 'pipeline/run.ts');
  await writeFile(join(path, 'pipeline/run.ts'), 'export const status = "completed";\n');
  await writeFile(join(path, 'new file.md'), 'A new guide.\n');
  await writeFile(join(path, 'ignored.txt'), 'not part of the diff\n');
  const before = git(path, 'status', '--porcelain');
  const snapshot = await readRepository(path);
  assert.deepEqual(snapshot.sections.map(s => s.path).sort(), ['new file.md', 'pipeline/run.ts']);
  const run = snapshot.sections.find(s => s.path === 'pipeline/run.ts');
  assert.ok(run.lines.some(line => line.type === 'add' && line.text.includes('completed')));
  assert.ok(run.lines.some(line => line.type === 'remove' && line.text.includes('running')));
  assert.equal(git(path, 'status', '--porcelain'), before);
});

test('supports unborn repositories, binary additions, and symlinks without reading their targets', async t => {
  const path = await fixture(t, false);
  await writeFile(join(path, 'image.bin'), Buffer.from([0, 1, 2, 3]));
  await symlink('/private/does-not-exist-ordiff', join(path, 'external-link'));
  const snapshot = await readRepository(path);
  assert.equal(snapshot.repo.hasHead, false);
  assert.ok(snapshot.sections.some(s => s.path === 'pipeline/run.ts' && s.lines.some(line => line.type === 'add')));
  assert.equal(snapshot.sections.find(s => s.path === 'image.bin').binary, true);
  assert.ok(snapshot.sections.find(s => s.path === 'external-link').lines.some(line => line.text === '/private/does-not-exist-ordiff'));
});

test('diff versions and hunk identifiers change when the underlying change changes', async t => {
  const path = await fixture(t);
  await writeFile(join(path, 'pipeline/run.ts'), 'export const status = "failed";\n');
  const first = await readRepository(path);
  assert.equal((await readRepository(path)).version, first.version);
  await writeFile(join(path, 'pipeline/run.ts'), 'export const status = "completed";\n');
  const next = await readRepository(path);
  assert.notEqual(next.version, first.version);
  assert.notEqual(next.sections[0].id, first.sections[0].id);
});

test('keeps separate hunks in one file independently addressable and includes deleted lines', async t => {
  const path = await fixture(t);
  const original = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
  await writeFile(join(path, 'multiple.txt'), original.join('\n') + '\n');
  git(path, 'add', '.'); git(path, 'commit', '-qm', 'multiple regions');
  original[1] = 'first changed region'; original[27] = 'second changed region';
  await writeFile(join(path, 'multiple.txt'), original.join('\n') + '\n');
  await rm(join(path, 'pipeline/run.ts'));
  const snapshot = await readRepository(path);
  const hunks = snapshot.sections.filter(s => s.path === 'multiple.txt');
  assert.equal(hunks.length, 2);
  assert.notEqual(hunks[0].id, hunks[1].id);
  assert.ok(snapshot.sections.find(s => s.path === 'pipeline/run.ts').lines.every(line => line.type === 'remove'));
});

test('a clean repository is distinct from a completed review and invalid connections preserve the existing workspace', async t => {
  const path = await fixture(t);
  const store = new WorkspaceStore();
  assert.equal(store.snapshot(), null);
  await store.connect(path);
  assert.equal(store.snapshot().sections.length, 0);
  await assert.rejects(store.connect('/private/ordiff-missing-repository'), /repository|directory/i);
  assert.equal(store.snapshot().repo.path, path);
});

test('accepts an ordered plan only for real current hunks and leaves uncovered changes unassigned', async t => {
  const path = await fixture(t);
  await writeFile(join(path, 'pipeline/run.ts'), 'export const status = "failed";\n');
  await writeFile(join(path, 'new.md'), 'Document failure.\n');
  const store = new WorkspaceStore();
  await store.connect(path);
  const snapshot = store.snapshot();
  const id = snapshot.sections.find(s => s.path === 'pipeline/run.ts').id;
  await store.submitPlan({ version: snapshot.version, groups: [{ id: 'failure', title: 'Expose failure status', description: 'Trace the new status.', steps: [{ sectionId: id, explanation: 'Start with the pipeline contract.' }] }] });
  assert.deepEqual(store.snapshot().groups[0].sections, [id]);
  assert.equal(store.snapshot().sections.find(s => s.path === 'new.md').group, null);
  assert.equal(store.snapshot().planStatus, 'current');
  await assert.rejects(store.submitPlan({ version: snapshot.version, groups: [{ id: 'bad', title: 'Unknown', description: '', steps: [{ sectionId: 'invented', explanation: '' }] }] }), /unknown|section/i);
});

test('editing the repository invalidates an old plan and rejects stale submissions', async t => {
  const path = await fixture(t);
  await writeFile(join(path, 'pipeline/run.ts'), 'export const status = "failed";\n');
  const store = new WorkspaceStore();
  await store.connect(path);
  const first = store.snapshot();
  const plan = { version: first.version, groups: [{ id: 'failure', title: 'Failure status', description: '', steps: [{ sectionId: first.sections[0].id, explanation: 'Review the new state.' }] }] };
  await store.submitPlan(plan);
  await writeFile(join(path, 'pipeline/run.ts'), 'export const status = "completed";\n');
  await assert.rejects(store.submitPlan(plan), /changed|stale|version/i);
  assert.equal(store.snapshot().groups.length, 0);
  assert.equal(store.snapshot().planStatus, 'stale');
});

test('repository selection and a valid plan survive a restart and reopening the same checkout', async t => {
  const path = await fixture(t);
  await writeFile(join(path, 'pipeline/run.ts'), 'export const status = "failed";\n');
  const stateFile = join(path, '.ordiff/workspace.json');
  const first = new WorkspaceStore({ stateFile });
  await first.connect(path);
  const snapshot = first.snapshot();
  await first.submitPlan({ version: snapshot.version, groups: [{ id: 'failure', title: 'Failure state', description: '', steps: [{ sectionId: snapshot.sections[0].id, explanation: 'Follow the state.' }] }] });
  const restored = new WorkspaceStore({ stateFile });
  await restored.restore();
  assert.equal(restored.snapshot().groups[0].title, 'Failure state');
  await restored.connect(path);
  assert.equal(restored.snapshot().groups[0]?.title, 'Failure state');
});
