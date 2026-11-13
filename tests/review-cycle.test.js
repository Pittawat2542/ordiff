import { buildPrompt } from "../src/prompt.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { readRepository } from "../server/git.js";
import { WorkspaceStore } from "../server/workspace.js";
const git = (root, ...args) =>
  execFileSync("git", ["-c", "commit.gpgsign=false", "-C", root, ...args], {
    encoding: "utf8",
  }).trim();
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "ordiff-cycle-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  await writeFile(join(root, ".gitignore"), ".ordiff/\n");
  await writeFile(join(root, "code.txt"), "one\ntwo\nthree\n");
  git(root, "add", ".");
  git(root, "commit", "-qm", "base");
  await writeFile(join(root, "code.txt"), "one\nchanged\nthree\n");
  return root;
}
test("captured text stays available after working files change", async (t) => {
  const root = await fixture(t);
  const snapshot = await readRepository(root);
  assert.equal(
    snapshot.files?.find((f) => f.path === "code.txt")?.afterText,
    "one\nchanged\nthree\n",
  );
  await writeFile(join(root, "code.txt"), "later\n");
  assert.equal(
    snapshot.files.find((f) => f.path === "code.txt").afterText,
    "one\nchanged\nthree\n",
  );
});
test("commit comparisons ignore unrelated working edits and resolve both revisions", async (t) => {
  const root = await fixture(t);
  const before = git(root, "rev-parse", "HEAD");
  git(root, "add", ".");
  git(root, "commit", "-qm", "second");
  const after = git(root, "rev-parse", "HEAD");
  await writeFile(join(root, "code.txt"), "unrelated\n");
  const snapshot = await readRepository(root, {
    kind: "commits",
    beforeRef: before,
    afterRef: after,
  });
  assert.equal(snapshot.files?.[0].afterText, "one\nchanged\nthree\n");
  assert.equal(snapshot.resolved?.after, after);
});
test("agent capture does not activate a new pass or replace the visible snapshot", async (t) => {
  const root = await fixture(t);
  const store = new WorkspaceStore();
  await store.connect(root);
  const first = store.snapshot();
  assert.equal(typeof store.capture, "function");
  await writeFile(join(root, "code.txt"), "agent edit\n");
  const fresh = await store.capture();
  assert.notEqual(fresh.version, first.version);
  assert.equal(store.snapshot().version, first.version);
  assert.equal(store.snapshot().cycle.pass.id, first.cycle.pass.id);
  await store.refresh();
  assert.notEqual(store.snapshot().cycle.pass.id, first.cycle.pass.id);
  assert.deepEqual(store.snapshot().cycle.pass.decisions, {});
});
test("feedback persists with optimistic conflicts and immutable published batches", async (t) => {
  const root = await fixture(t);
  const store = new WorkspaceStore({
    stateFile: join(root, ".ordiff/workspace.json"),
  });
  await store.connect(root);
  assert.equal(typeof store.cycleAction, "function");
  const c = await store.cycleAction("comment.create", {
    path: "code.txt",
    text: "Fix this",
    intent: "change",
    clientMutationId: "create",
  });
  const batch = await store.cycleAction("batch.publish", {
    commentIds: [c.id],
    includeGeneral: false,
    clientMutationId: "publish",
  });
  assert.equal(
    batch.markdown,
    buildPrompt(store.snapshot(), store.snapshot().cycle.feedback, {
      paths: ["code.txt"],
      includeGeneral: false,
    }),
  );
  await store.cycleAction("comment.update", {
    id: c.id,
    expectedRevision: c.revision,
    patch: { text: "Different request" },
    clientMutationId: "edit",
  });
  await assert.rejects(
    store.cycleAction("comment.update", {
      id: c.id,
      expectedRevision: c.revision,
      patch: { text: "Lost update" },
      clientMutationId: "stale",
    }),
    (e) => e.status === 409,
  );
  assert.equal(
    (await store.cycleAction("batch.get", { id: batch.id })).comments[0].text,
    "Fix this",
  );
  const reopened = new WorkspaceStore({
    stateFile: join(root, ".ordiff/workspace.json"),
  });
  await reopened.restore();
  assert.equal(
    reopened.snapshot().cycle.feedback.comments[0].text,
    "Different request",
  );
});
test("agent reports apply only to the published comment revision and never resolve feedback", async (t) => {
  const root = await fixture(t);
  const store = new WorkspaceStore();
  await store.connect(root);
  assert.equal(typeof store.cycleAction, "function");
  const c = await store.cycleAction("comment.create", {
    path: "code.txt",
    text: "Fix",
    intent: "change",
    clientMutationId: "c",
  });
  const b = await store.cycleAction("batch.publish", {
    commentIds: [c.id],
    clientMutationId: "b",
  });
  await store.cycleAction("batch.report", {
    id: b.id,
    snapshotId: store.snapshot().version,
    outcomes: [{ commentId: c.id, outcome: "addressed", explanation: "Fixed" }],
    clientMutationId: "r",
  });
  assert.equal(store.snapshot().cycle.feedback.comments[0].status, "addressed");
  const current = store.snapshot().cycle.feedback.comments[0];
  await store.cycleAction("comment.update", {
    id: c.id,
    expectedRevision: current.revision,
    patch: { text: "New request" },
    clientMutationId: "e",
  });
  await store.cycleAction("batch.report", {
    id: b.id,
    snapshotId: store.snapshot().version,
    outcomes: [
      { commentId: c.id, outcome: "addressed", explanation: "Old fix" },
    ],
    clientMutationId: "r2",
  });
  assert.equal(store.snapshot().cycle.feedback.comments[0].status, "open");
});
test("review decisions are pass-scoped and stale decisions cannot overwrite newer actions", async (t) => {
  const root = await fixture(t);
  const store = new WorkspaceStore();
  await store.connect(root);
  assert.equal(typeof store.cycleAction, "function");
  const s = store.snapshot();
  await store.cycleAction("decision", {
    passId: s.cycle.pass.id,
    sectionId: s.sections[0].id,
    status: "deferred",
    expectedRevision: 0,
    clientMutationId: "d",
  });
  assert.equal(
    store.snapshot().cycle.pass.decisions[s.sections[0].id].status,
    "deferred",
  );
  await assert.rejects(
    store.cycleAction("decision", {
      passId: s.cycle.pass.id,
      sectionId: s.sections[0].id,
      status: "reviewed",
      expectedRevision: 0,
      clientMutationId: "bad",
    }),
    (e) => e.status === 409,
  );
  await store.cycleAction("pass.restart", { clientMutationId: "restart" });
  assert.deepEqual(store.snapshot().cycle.pass.decisions, {});
});
test("manual plans survive capture and agent replacements remain proposals", async (t) => {
  const root = await fixture(t);
  const store = new WorkspaceStore();
  await store.connect(root);
  const s = store.snapshot();
  const groups = [
    {
      id: "manual",
      title: "My reading order",
      description: "",
      sections: [s.sections[0].id],
      explanations: {},
    },
  ];
  await store.cycleAction("plan.save", {
    groups,
    expectedRevision: 0,
    clientMutationId: "manual",
  });
  await store.capture();
  assert.equal(store.snapshot().groups[0].title, "My reading order");
  const proposal = await store.cycleAction("plan.propose", {
    snapshotId: s.version,
    groups: [{ ...groups[0], title: "Agent order" }],
    clientMutationId: "proposal",
  });
  assert.equal(proposal.status, "pending");
  assert.equal(store.snapshot().groups[0].title, "My reading order");
  await store.cycleAction("plan.accept", {
    id: proposal.id,
    expectedRevision: 1,
    clientMutationId: "accept",
  });
  assert.equal(store.snapshot().groups[0].title, "Agent order");
});
test("captured source API returns the selected lines and refuses a cross-repository file", async (t) => {
  const { createApi } = await import("../server/api.js");
  const { Readable } = await import("node:stream");
  const root = await fixture(t),
    store = new WorkspaceStore();
  await store.connect(root);
  const s = store.snapshot(),
    file = s.files[0];
  const api = createApi({ store });
  async function call(url) {
    let status, body;
    const request = Readable.from([]);
    Object.assign(request, {
      method: "GET",
      url,
      headers: { host: "127.0.0.1:5173" },
    });
    await api(request, {
      writeHead(code) {
        status = code;
      },
      end(data) {
        body = JSON.parse(data);
      },
    });
    return { status, body };
  }
  const response = await call(
    `/api/snapshots/${s.version}/files/${file.id}/text?side=after&start=2&limit=1`,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.lines, [{ number: 2, text: "changed" }]);
  assert.equal(
    (await call(`/api/snapshots/${s.version}/files/invented/text?side=after`))
      .status,
    404,
  );
});
test("restart preserves the active snapshot when the worktree changed while closed", async (t) => {
  const root = await fixture(t),
    stateFile = join(root, ".ordiff/workspace.json");
  const store = new WorkspaceStore({ stateFile });
  await store.connect(root);
  const original = store.snapshot();
  await writeFile(join(root, "code.txt"), "changed while closed\n");
  const reopened = new WorkspaceStore({ stateFile });
  await reopened.restore();
  assert.equal(reopened.snapshot().version, original.version);
  assert.equal(reopened.snapshot().cycle.pass.id, original.cycle.pass.id);
});
test("clearing historical source removes payloads while retaining feedback and history", async (t) => {
  const root = await fixture(t),
    store = new WorkspaceStore();
  await store.connect(root);
  const first = store.snapshot();
  await store.cycleAction("comment.create", {
    path: "code.txt",
    text: "Keep this note",
    intent: "note",
    clientMutationId: "note",
  });
  await writeFile(join(root, "code.txt"), "new pass\n");
  await store.refresh();
  await store.cycleAction("storage.clear", { clientMutationId: "clear" });
  assert.throws(
    () => store.reviews.getSnapshot(store.snapshot().repo.path, first.version),
    (e) => e.status === 410,
  );
  assert.equal(
    store.snapshot().cycle.feedback.comments[0].text,
    "Keep this note",
  );
  assert.equal(store.snapshot().cycle.history[0].available, false);
});
test("a comment anchor cannot reference another comparison or a false quote", async (t) => {
  const root = await fixture(t),
    store = new WorkspaceStore();
  await store.connect(root);
  const first = store.snapshot();
  const before = git(root, "rev-parse", "HEAD");
  git(root, "add", ".");
  git(root, "commit", "-qm", "next");
  await store.selectComparison({
    kind: "commits",
    beforeRef: before,
    afterRef: "HEAD",
  });
  await assert.rejects(
    store.cycleAction("comment.create", {
      path: "code.txt",
      text: "bad anchor",
      intent: "change",
      anchor: {
        snapshotId: first.version,
        fileId: first.files[0].id,
        path: "code.txt",
        side: "after",
        startLine: 2,
        endLine: 2,
        quote: "fabricated",
      },
      clientMutationId: "wrong",
    }),
    (e) => e.status === 422,
  );
});
test("retention keeps active source and evicts old unleased payloads", async (t) => {
  const root = await fixture(t),
    store = new WorkspaceStore({
      reviewLimits: { maxSnapshots: 2, leaseMs: 0 },
    });
  await store.connect(root);
  const first = store.snapshot();
  for (const text of ["second\n", "third\n"]) {
    await writeFile(join(root, "code.txt"), text);
    await store.refresh();
  }
  assert.throws(
    () => store.reviews.getSnapshot(store.snapshot().repo.path, first.version),
    (e) => e.status === 410,
  );
  assert.equal(store.snapshot().cycle.history.length, 3);
  assert.equal(store.snapshot().cycle.storage.snapshots, 2);
});
test("a failed durable feedback write does not publish or retain the mutation", async (t) => {
  const root = await fixture(t),
    stateFile = join(root, ".ordiff/workspace.json"),
    store = new WorkspaceStore({ stateFile });
  await store.connect(root);
  const { rename } = await import("node:fs/promises");
  await rename(
    join(root, ".ordiff/reviews"),
    join(root, ".ordiff/reviews-backup"),
  );
  await writeFile(join(root, ".ordiff/reviews"), "blocked");
  const revision = store.revision;
  await assert.rejects(
    store.cycleAction("comment.create", {
      path: "code.txt",
      text: "unsaved",
      intent: "note",
      clientMutationId: "failure",
    }),
  );
  assert.equal(store.snapshot().cycle.feedback.comments.length, 0);
  assert.equal(store.revision, revision);
});
test("two backends cannot own the same data root and release permits a new owner", async (t) => {
  const root = await fixture(t),
    stateFile = join(root, ".ordiff/workspace.json"),
    a = new WorkspaceStore({ stateFile }),
    b = new WorkspaceStore({ stateFile });
  assert.equal(typeof a.acquire, "function");
  await a.acquire();
  await assert.rejects(b.acquire(), (e) => e.code === "DATA_LOCKED");
  await a.close();
  await b.acquire();
  await b.close();
});
test("immutable source downloads use captured text after the worktree changes", async (t) => {
  const { createApi } = await import("../server/api.js");
  const { Readable } = await import("node:stream");
  const root = await fixture(t),
    store = new WorkspaceStore();
  await store.connect(root);
  const s = store.snapshot();
  await writeFile(join(root, "code.txt"), "later\n");
  const api = createApi({ store });
  let status, body;
  const request = Readable.from([]);
  Object.assign(request, {
    method: "GET",
    url: `/api/snapshots/${s.version}/files/${s.files[0].id}/content?side=after`,
    headers: { host: "127.0.0.1:5173" },
  });
  await api(request, {
    writeHead(c) {
      status = c;
    },
    end(value) {
      body = value;
    },
  });
  assert.equal(status, 200);
  assert.equal(String(body), "one\nchanged\nthree\n");
});
test("changing lifecycle status keeps the original anchor and editing reopens feedback", async (t) => {
  const root = await fixture(t),
    store = new WorkspaceStore();
  await store.connect(root);
  const w = store.snapshot();
  const c = await store.cycleAction("comment.create", {
    path: "code.txt",
    text: "Fix",
    intent: "change",
    anchor: {
      snapshotId: w.version,
      fileId: w.files[0].id,
      path: "code.txt",
      side: "after",
      startLine: 2,
      endLine: 2,
      quote: "fabricated",
    },
    clientMutationId: "anchor",
  });
  assert.equal(c.anchor.quote, "changed");
  const resolved = await store.cycleAction("comment.update", {
    id: c.id,
    expectedRevision: c.revision,
    patch: { status: "resolved" },
    clientMutationId: "resolve",
  });
  const edited = await store.cycleAction("comment.update", {
    id: c.id,
    expectedRevision: resolved.revision,
    patch: { text: "More detail" },
    clientMutationId: "edit-again",
  });
  assert.equal(edited.status, "open");
  assert.equal(edited.anchor.quote, "changed");
});
test("clearing a line anchor makes a file comment without losing the original reference", async (t) => {
  const root = await fixture(t),
    store = new WorkspaceStore();
  await store.connect(root);
  const w = store.snapshot();
  const c = await store.cycleAction("comment.create", {
    path: "code.txt",
    text: "Check",
    intent: "change",
    anchor: {
      snapshotId: w.version,
      fileId: w.files[0].id,
      path: "code.txt",
      side: "after",
      startLine: 2,
      endLine: 2,
    },
    clientMutationId: "line",
  });
  const changed = await store.cycleAction("comment.update", {
    id: c.id,
    expectedRevision: c.revision,
    patch: { anchor: null, section: null },
    clientMutationId: "file",
  });
  assert.equal(changed.anchor, undefined);
  assert.equal(changed.originalAnchor.quote, "changed");
});
test("deleting review data requires the repository name and starts one clean pass", async (t) => {
  const root = await fixture(t),
    store = new WorkspaceStore();
  await store.connect(root);
  const name = store.snapshot().repo.name;
  await store.cycleAction("comment.create", {
    path: "code.txt",
    text: "remove me",
    intent: "note",
    clientMutationId: "delete-note",
  });
  await assert.rejects(
    store.cycleAction("storage.reset", {
      confirmRepository: "wrong",
      clientMutationId: "wrong-confirm",
    }),
  );
  await store.cycleAction("storage.reset", {
    confirmRepository: name,
    clientMutationId: "reset",
  });
  assert.equal(store.snapshot().cycle.feedback.comments.length, 0);
  assert.equal(store.snapshot().cycle.history.length, 1);
});

test("mutation IDs reject different payloads and comment IDs cannot overwrite existing text", async (t) => {
  const root = await fixture(t),
    store = new WorkspaceStore();
  await store.connect(root);
  const input = {
    id: "stable-comment",
    path: "code.txt",
    text: "first",
    intent: "change",
    clientMutationId: "stable-mutation",
  };
  const first = await store.cycleAction("comment.create", input);
  assert.deepEqual(await store.cycleAction("comment.create", input), first);
  await assert.rejects(
    store.cycleAction("comment.create", { ...input, text: "different" }),
    (e) => e.status === 409,
  );
  await assert.rejects(
    store.cycleAction("comment.create", {
      ...input,
      text: "different",
      clientMutationId: "another",
    }),
    (e) => e.status === 409,
  );
  assert.equal(store.snapshot().cycle.feedback.comments[0].text, "first");
});

test("large text capture and a thousand comments retain complete source and exact wording", async (t) => {
  const root = await fixture(t);
  const text =
    Array.from({ length: 20000 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
  await writeFile(join(root, "code.txt"), text);
  const store = new WorkspaceStore();
  await store.connect(root);
  assert.equal(
    store.snapshot().files.find((f) => f.path === "code.txt").afterText,
    text,
  );
  const comments = Array.from({ length: 1000 }, (_, i) => ({
    id: `large-${i}`,
    path: "code.txt",
    text: `Request ${i}`,
    intent: "note",
  }));
  await store.cycleAction("import", {
    installationId: "large-fixture",
    feedback: { comments, general: "" },
  });
  assert.equal(store.snapshot().cycle.feedback.comments.length, 1000);
  const batch = await store.cycleAction("batch.publish", {
    commentIds: comments.map((c) => c.id),
    includeGeneral: false,
  });
  assert.equal(batch.comments.length, 1000);
  assert.match(batch.markdown, /Request 999/);
});

test("the 500-file boundary is accepted and additional files are rejected explicitly", async (t) => {
  const root = await fixture(t);
  await Promise.all(
    Array.from({ length: 499 }, (_, i) =>
      writeFile(join(root, `file-${i}.txt`), "change\n"),
    ),
  );
  const snapshot = await readRepository(root);
  assert.equal(snapshot.files.length, 500);
  await writeFile(join(root, "overflow.txt"), "change\n");
  await assert.rejects(readRepository(root), /500|too many/i);
});
