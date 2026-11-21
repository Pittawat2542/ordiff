import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, realpath } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, relative } from 'node:path';
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

test('role classification uses repository paths without sample-specific filename exceptions', async t => {
  const path = await fixture(t);
  await mkdir(join(path, 'src'));
  await writeFile(join(path, 'src/review.ts'), 'export const reviewed = false;\n');
  await writeFile(join(path, 'src/data.ts'), 'export const rows = [];\n');
  await writeFile(join(path, 'pipeline/run.ts'), 'export const status = "failed";\n');
  const snapshot = await readRepository(path);
  assert.equal(snapshot.sections.find(s => s.path === 'src/review.ts').role, 'Code');
  assert.equal(snapshot.sections.find(s => s.path === 'src/data.ts').role, 'Code');
  assert.equal(snapshot.sections.find(s => s.path === 'pipeline/run.ts').role, 'Pipeline');
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
  const traceFile = join(path, '.ordiff/startup-git.trace');
  const previousTrace = process.env.GIT_TRACE;
  process.env.GIT_TRACE = traceFile;
  try { await restored.restore(); }
  finally {
    if (previousTrace === undefined) delete process.env.GIT_TRACE;
    else process.env.GIT_TRACE = previousTrace;
  }
  assert.equal(restored.snapshot().groups[0].title, 'Failure state');
  assert.equal(restored.snapshot().version, snapshot.version);
  const scans = (await readFile(traceFile, 'utf8')).match(/rev-parse --show-toplevel/g) || [];
  assert.equal(scans.length, 1, 'Restoring a saved plan must reuse the fresh startup Git snapshot.');
  await restored.connect(path);
  assert.equal(restored.snapshot().groups[0]?.title, 'Failure state');
});

test('recent repositories deduplicate repository roots and exclude failed connections', async t => {
  const first = await fixture(t);
  const second = await fixture(t);
  const store = new WorkspaceStore();
  await store.connect(first);
  await store.connect(second);
  await store.connect(join(first, 'pipeline'));
  await assert.rejects(store.connect(join(first, 'missing')));
  assert.deepEqual(store.recentRepositories.map(repo => repo.path), [first, second]);
  assert.equal(store.snapshot().repo.path, first);
});

test('restoring preserves the active durable pass despite stale legacy plans and newer working edits', async t => {
  const path = await fixture(t);
  await writeFile(join(path, 'pipeline/run.ts'), 'export const status = "failed";\n');
  const stateFile = join(path, '.ordiff/workspace.json');
  const store = new WorkspaceStore({ stateFile });
  await store.connect(path);
  const snapshot = store.snapshot();
  const plan = { version: snapshot.version, groups: [{ id: 'failure', title: 'Failure state', description: '', steps: [{ sectionId: snapshot.sections[0].id, explanation: '' }] }] };
  await store.submitPlan(plan);
  const saved = JSON.parse(await readFile(stateFile, 'utf8'));
  await writeFile(stateFile, JSON.stringify({ ...saved, plan: { ...plan, groups: [{ ...plan.groups[0], steps: [{ sectionId: 'missing', explanation: '' }] }] } }));
  const invalid = new WorkspaceStore({ stateFile });
  await invalid.restore();
  assert.equal(invalid.snapshot().repo.path, path);
  assert.equal(invalid.snapshot().planStatus, 'current');
  assert.equal(invalid.snapshot().groups[0].title, 'Failure state');

  await writeFile(stateFile, JSON.stringify(saved));
  await writeFile(join(path, 'pipeline/run.ts'), 'export const status = "completed";\n');
  const stale = new WorkspaceStore({ stateFile });
  await stale.restore();
  assert.equal(stale.snapshot().version, snapshot.version);
  assert.notEqual(stale.snapshot().cycle.latestSnapshotId,snapshot.version);
  assert.equal(stale.snapshot().planStatus, 'current');
  assert.equal(stale.snapshot().groups[0].title,'Failure state');
  assert.ok(stale.snapshot().sections[0].lines.some(line => line.type === 'add' && line.text.includes('failed')));
});

test('recent history keeps ten entries and survives disconnect and restart', async t => {
  const roots = [];
  const stateFile = join(await fixture(t), '.ordiff/workspace.json');
  const store = new WorkspaceStore({ stateFile });
  for (let i = 0; i < 11; i++) {
    const path = await fixture(t);
    roots.push(path);
    await store.connect(path);
  }
  await store.disconnect();
  const restored = new WorkspaceStore({ stateFile });
  await restored.restore();
  assert.equal(restored.snapshot(), null);
  assert.deepEqual(restored.recentRepositories.map(repo => repo.path), roots.slice(1).reverse());
});

test('removing an active recent repository preserves the workspace and stays removed on restore', async t => {
  const path = await fixture(t);
  const stateFile = join(path, '.ordiff/workspace.json');
  const store = new WorkspaceStore({ stateFile });
  await store.connect(path);
  const revision = store.revision;
  await store.removeRecentRepository(path);
  assert.equal(store.revision, revision + 1);
  assert.equal(store.snapshot().repo.path, path);
  const restored = new WorkspaceStore({ stateFile });
  await restored.restore();
  assert.equal(restored.snapshot().repo.path, path);
  assert.deepEqual(restored.recentRepositories, []);
  assert.deepEqual(JSON.parse(await readFile(stateFile, 'utf8')).recentRepositories, []);
});

test('legacy state seeds history but inaccessible active paths do not discard saved history', async t => {
  const path = await fixture(t);
  const stateFile = join(path, 'workspace.json');
  await writeFile(stateFile, JSON.stringify({ path }));
  const legacy = new WorkspaceStore({ stateFile });
  await legacy.restore();
  assert.equal(legacy.recentRepositories[0].path, path);
  await writeFile(stateFile, JSON.stringify({ path: join(path, 'missing'), recentRepositories: [{ name: 'saved', path }] }));
  const restored = new WorkspaceStore({ stateFile });
  await restored.restore();
  assert.equal(restored.snapshot(), null);
  assert.deepEqual(restored.recentRepositories, [{ name: 'saved', path }]);
});

test('home-relative repository paths resolve to their canonical root', async t => {
  const path = await fixture(t);
  const snapshot = await readRepository(`~/${relative(homedir(), path)}`);
  assert.equal(snapshot.repo.path, path);
});

test("queued handoffs survive deletion of their checkout, duplicate delivery and restart", async (t) => {
  const root = await fixture(t);
  const path = await fixture(t);
  const stateFile = join(root, ".ordiff/workspace.json");
  const initial = new WorkspaceStore({ stateFile });
  await initial.connect(root);
  await writeFile(join(path, "note.txt"), "original handoff\n");
  const snapshot = await readRepository(path);
  const { HandoffQueue } = await import("../server/handoff-queue.js");
  const queue = new HandoffQueue(join(root, ".ordiff"));
  queue.capture(snapshot);
  const plan = {
    snapshotId: snapshot.version,
    groups: [
      {
        id: "g",
        title: "Read note",
        sections: [snapshot.sections[0].id],
        explanations: {},
      },
    ],
  };
  const receipt = queue.enqueue(path, plan);
  assert.equal(queue.enqueue(path, plan), receipt);
  await rm(path, { recursive: true });
  const restored = new WorkspaceStore({ stateFile });
  await restored.restore();
  await restored.importHandoffs();
  assert.equal(restored.snapshot().repo.path, root);
  assert.equal(restored.repositories.find((r) => r.path === path).unseen, true);
  await restored.connect(path);
  assert.equal(restored.snapshot().groups[0].title, "Read note");
  assert.equal(restored.snapshot().version, snapshot.version);
  const reopened = new WorkspaceStore({ stateFile });
  await reopened.restore();
  assert.equal(reopened.snapshot().version, snapshot.version);
});

test("a full inbox rejects the write and preserves the previous receipt", async (t) => {
  const { HandoffQueue } = await import("../server/handoff-queue.js");
  const path = await fixture(t, false);
  const snapshot = await readRepository(path);
  const queue = new HandoffQueue(
    join(path, ".ordiff"),
    Buffer.byteLength(JSON.stringify(snapshot)) + 300,
  );
  queue.capture(snapshot);
  const groups = [
    {
      id: "g",
      title: "Review",
      sections: [snapshot.sections[0].id],
      explanations: {},
    },
  ];
  const receipt = queue.enqueue(path, { snapshotId: snapshot.version, groups });
  assert.throws(
    () =>
      queue.enqueue(path, {
        snapshotId: snapshot.version,
        groups: [{ ...groups[0], description: "x".repeat(500) }],
      }),
    /full/,
  );
  assert.deepEqual(
    queue.pending().map((row) => row.receipt),
    [receipt],
  );
});

test("switching back resumes the selected comparison and can open activity on an earlier comparison", async (t) => {
  const path = await fixture(t);
  const other = await fixture(t);
  const store = new WorkspaceStore();
  await writeFile(join(path, "local.txt"), "working changes\n");
  await store.connect(path);
  const working = store.snapshot();
  const head = git(path, "rev-parse", "HEAD");
  await store.selectComparison(
    { kind: "commits", beforeRef: head, afterRef: head },
    working.repositoryId,
  );
  const commits = store.snapshot();
  await store.connect(other);
  await store.agentPlan({
    repositoryPath: path,
    snapshotId: working.version,
    groups: [
      {
        id: "local",
        title: "Read working changes",
        sections: [working.sections[0].id],
        explanations: {},
      },
    ],
  });
  const entry = store.repositories.find((row) => row.path === path);
  assert.equal(entry.activityComparisonId, working.comparisonId);
  await store.connect(path);
  assert.equal(store.snapshot().comparisonId, commits.comparisonId);
  await store.connect(path, { comparisonId: entry.activityComparisonId });
  assert.equal(store.snapshot().cycle.pass.id, working.cycle.pass.id);
  assert.equal(store.snapshot().groups[0].title, "Read working changes");
});

test("concurrent agents in sibling worktrees deliver independent plans without changing selection", async (t) => {
  const root = await fixture(t);
  const base = await realpath(
    await mkdtemp(join(tmpdir(), "ordiff-worktrees-")),
  );
  t.after(() => rm(base, { recursive: true, force: true }));
  const worktrees = ["api", "web"].map((name) => join(base, name));
  for (const path of worktrees) {
    git(root, "worktree", "add", "--detach", path, "HEAD");
    await writeFile(join(path, "changes.txt"), path);
  }
  const store = new WorkspaceStore();
  await store.connect(root);
  await Promise.all(
    worktrees.map(async (repositoryPath) => {
      const { snapshot } = await store.agentContext({ repositoryPath });
      await store.agentPlan({
        repositoryPath,
        snapshotId: snapshot.version,
        groups: [
          {
            id: "changes",
            title: repositoryPath,
            sections: [snapshot.sections[0].id],
            explanations: {},
          },
        ],
      });
    }),
  );
  assert.deepEqual(
    store.repositories
      .filter((r) => r.unseen)
      .map((r) => r.path)
      .sort(),
    worktrees,
  );
  assert.equal(store.snapshot().repo.path, root);
  for (const path of worktrees) {
    await store.connect(path);
    assert.equal(store.snapshot().groups[0].title, path);
  }
});

test("failed handoff imports identify the checkout and can be retried after storage is available", async (t) => {
  const root = await fixture(t, false);
  const stateFile = join(root, ".ordiff/workspace.json");
  const { HandoffQueue } = await import("../server/handoff-queue.js");
  const snapshot = await readRepository(root);
  const queue = new HandoffQueue(join(root, ".ordiff"));
  queue.capture(snapshot);
  const receipt = queue.enqueue(root, {
    snapshotId: snapshot.version,
    groups: [
      {
        id: "work",
        title: "Work",
        sections: [snapshot.sections[0].id],
        explanations: {},
      },
    ],
  });
  const limited = new WorkspaceStore({
    stateFile,
    reviewLimits: { maxBytes: 1 },
  });
  const failures = await limited.importHandoffs();
  assert.equal(failures[0].path, root);
  assert.equal(failures[0].receipt, receipt);
  assert.equal(queue.pending().length, 1);
  const restored = new WorkspaceStore({ stateFile });
  assert.deepEqual(await restored.importHandoffs(), []);
  assert.equal(queue.pending().length, 0);
  assert.equal(restored.snapshot(), null);
  assert.ok(restored.repositories[0].unseen);
});

test("a plan can target the same subdirectory used for its capture", async (t) => {
  const path = await fixture(t, false);
  const repositoryPath = join(path, "pipeline");
  const store = new WorkspaceStore();
  const { snapshot } = await store.agentContext({ repositoryPath });
  await store.agentPlan({
    repositoryPath,
    snapshotId: snapshot.version,
    groups: [
      {
        id: "subdir",
        title: "Subdirectory",
        sections: [snapshot.sections[0].id],
        explanations: {},
      },
    ],
  });
  assert.equal(store.repositories[0].path, path);
});

test("published feedback and outcome reports stay in their originating checkout", async (t) => {
  const first = await fixture(t, false);
  const other = await fixture(t);
  const store = new WorkspaceStore();
  await store.connect(first);
  const { repositoryId, comparisonId, version } = store.snapshot();
  const scope = { repositoryId, comparisonId };
  const comment = await store.cycleAction("comment.create", {
    path: "pipeline/run.ts",
    text: "Check the status",
    intent: "change",
  });
  const batch = await store.cycleAction("batch.publish", {
    commentIds: [comment.id],
  });
  await store.connect(other);
  const read = await store.agentFeedback("batch.get", {
    ...scope,
    id: batch.id,
  });
  assert.equal(read.comments[0].text, "Check the status");
  const report = {
    ...scope,
    id: batch.id,
    snapshotId: version,
    clientMutationId: "report-status",
    outcomes: [
      {
        commentId: comment.id,
        outcome: "addressed",
        explanation: "Checked the source",
      },
    ],
  };
  await store.agentFeedback("batch.report", report);
  assert.equal(
    store.repositories.find((r) => r.path === first).activity,
    "Feedback report",
  );
  assert.equal(store.snapshot().cycle.reports.length, 0);
  assert.equal(store.snapshot().repo.path, other);
  await assert.rejects(
    store.agentFeedback("batch.get", {
      repositoryPath: other,
      comparisonId,
      id: batch.id,
    }),
  );
  await store.connect(first);
  await store.agentFeedback("batch.report", report);
  assert.equal(store.snapshot().cycle.reports.length, 1);
  assert.equal(store.repositories.find((r) => r.path === first).unseen, false);
});
