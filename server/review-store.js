import { formatPrompt } from "../shared/prompt.js";
import { randomUUID, createHash } from "node:crypto";
import {
  readFile,
  mkdir,
  writeFile,
  rename,
  rm,
  readdir,
} from "node:fs/promises";
import { join, dirname } from "node:path";

const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
const now = () => new Date().toISOString();
export function cycleError(status, code, message, extra = {}) {
  return Object.assign(new Error(message), { status, code, ...extra });
}
const fail = (status, code, message, extra) => {
  throw cycleError(status, code, message, extra);
};
const revision = (record, expected) => {
  if ((record?.revision || 0) !== expected)
    fail(
      409,
      "REVISION_CONFLICT",
      "This record changed in another window. Your draft has been kept.",
      { currentRevision: record?.revision || 0, current: record },
    );
};
const fingerprint = (s) =>
  digest([s.path, (s.lines || []).map((l) => [l.type, l.text])]);
export function matchSections(previous, current) {
  const matches = {},
    used = new Set();
  for (const section of current.sections) {
    const candidates = (previous?.sections || []).filter(
      (old) =>
        old.path === section.path && fingerprint(old) === fingerprint(section),
    );
    const currentCopies = current.sections.filter(
      (s) => s.path === section.path && fingerprint(s) === fingerprint(section),
    );
    if (candidates.length === 1 && currentCopies.length === 1) {
      matches[section.id] = { previousId: candidates[0].id, kind: "unchanged" };
      used.add(candidates[0].id);
    }
  }
  // Only unique, overlapping ranges establish a modified correspondence; ambiguous hunks stay unmatched.
  const range = (s) =>
    (s.lines || []).map((l) => l.old).filter((n) => n !== null);
  for (const section of current.sections.filter((s) => !matches[s.id])) {
    const lines = range(section);
    if (!lines.length) continue;
    const candidates = (previous?.sections || []).filter(
      (old) =>
        !used.has(old.id) &&
        old.path === section.path &&
        range(old).some((n) => lines.includes(n)),
    );
    if (candidates.length !== 1) continue;
    const old = candidates[0];
    const reverse = current.sections.filter(
      (s) =>
        !matches[s.id] &&
        s.path === old.path &&
        range(s).some((n) => range(old).includes(n)),
    );
    if (reverse.length === 1) {
      matches[section.id] = { previousId: old.id, kind: "modified" };
      used.add(old.id);
    }
  }
  return {
    matches,
    removed: (previous?.sections || [])
      .filter((s) => !used.has(s.id))
      .map((s) => ({ id: s.id, path: s.path, symbol: s.symbol })),
  };
}
function newPass(snapshot, previous = null) {
  return {
    id: randomUUID(),
    snapshotId: snapshot.version,
    previousPassId: previous?.id || null,
    createdAt: now(),
    decisions: {},
    checks: {},
    planRevision: 0,
    groups: [],
    planHistory: [],
  };
}
export class ReviewStore {
  constructor(stateFile, limits = {}) {
    this.limits = {
      maxSnapshots: 10,
      maxBytes: 512 * 1024 * 1024,
      leaseMs: 30 * 60 * 1000,
      ...limits,
    };
    this.root = stateFile ? join(dirname(stateFile), "reviews") : null;
    this.records = new Map();
  }
  async load(path) {
    if (this.records.has(path)) return this.records.get(path);
    let data;
    if (this.root)
      try {
        data = JSON.parse(
          await readFile(
            join(this.root, digest(path), "metadata.json"),
            "utf8",
          ),
        );
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    if (data && data.schemaVersion !== 1)
      fail(
        409,
        "UNSUPPORTED_SCHEMA",
        "This review store needs a compatible Ordiff version. It has not been changed.",
      );
    data ||= {
      schemaVersion: 1,
      repository: { id: randomUUID(), path },
      comparisons: {},
      snapshots: {},
      imports: {},
      mutations: {},
    };
    if (this.root)
      for (const [id, metadata] of Object.entries(data.snapshots)) {
        if (metadata.evicted) continue;
        try {
          data.snapshots[id] = JSON.parse(
            await readFile(
              join(this.root, digest(path), "snapshots", `${id}.json`),
              "utf8",
            ),
          );
          for (const file of data.snapshots[id].files || [])
            for (const side of ["before", "after"])
              if (file[`${side}TextHash`])
                file[`${side}Text`] = await readFile(
                  join(this.root, "blobs", file[`${side}TextHash`] + ".txt"),
                  "utf8",
                );
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
          metadata.evicted = true;
        }
      }
    this.records.set(path, data);
    return data;
  }
  async persist(data) {
    await this.retain(data);
    if (!this.root) return;
    const directory = join(this.root, digest(data.repository.path));
    await mkdir(join(this.root, "blobs"), { recursive: true });
    await mkdir(join(directory, "snapshots"), { recursive: true });
    const metadata = structuredClone(data);
    for (const [id, snapshot] of Object.entries(data.snapshots)) {
      if (!snapshot.evicted) {
        const file = join(directory, "snapshots", `${id}.json`);
        const payload = structuredClone(snapshot);
        for (const f of payload.files || [])
          for (const side of ["before", "after"])
            if (typeof f[`${side}Text`] === "string") {
              const text = f[`${side}Text`],
                hash = createHash("sha256").update(text).digest("hex");
              try {
                await writeFile(join(this.root, "blobs", hash + ".txt"), text, {
                  mode: 0o600,
                  flag: "wx",
                });
              } catch (e) {
                if (e.code !== "EEXIST") throw e;
              }
              f[`${side}TextHash`] = hash;
              delete f[`${side}Text`];
            }
        await writeFile(`${file}.tmp`, JSON.stringify(payload), {
          mode: 0o600,
        });
        await rename(`${file}.tmp`, file);
      }
      metadata.snapshots[id] = {
        version: id,
        comparisonId: snapshot.comparisonId,
        capturedAt: snapshot.capturedAt,
        evicted: !!snapshot.evicted,
        bytes: Buffer.byteLength(JSON.stringify(snapshot)),
        sections: snapshot.sections.map((s) => ({
          id: s.id,
          path: s.path,
          symbol: s.symbol,
        })),
        files: [],
      };
    }
    const file = join(directory, "metadata.json");
    await writeFile(`${file}.tmp`, JSON.stringify(metadata), { mode: 0o600 });
    await rename(`${file}.tmp`, file);
    // Cleanup follows the commit and cannot turn a committed write into a reported failure.
    try {
      for (const [id, snapshot] of Object.entries(data.snapshots))
        if (snapshot.evicted)
          await rm(join(directory, "snapshots", `${id}.json`), { force: true });
      await this.collectBlobs();
    } catch {
      /* Retry garbage collection on the next commit. */
    }
  }
  async retain(data) {
    data.leases ||= {};
    const available = Object.values(data.snapshots)
      .filter((s) => !s.evicted)
      .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
    const pinned = (id) =>
      id === data.activeSnapshotId || (data.leases[id] || 0) > Date.now();
    let count = available.length,
      bytes = available.reduce(
        (sum, s) => sum + Buffer.byteLength(JSON.stringify(s)),
        0,
      ),
      otherBytes = 0;
    if (this.root)
      try {
        for (const entry of await readdir(this.root)) {
          if (entry === digest(data.repository.path) || entry === "blobs")
            continue;
          try {
            const other = JSON.parse(
              await readFile(join(this.root, entry, "metadata.json"), "utf8"),
            );
            otherBytes += Object.values(other.snapshots)
              .filter((s) => !s.evicted)
              .reduce((sum, s) => sum + (s.bytes || 0), 0);
          } catch (e) {
            if (e.code !== "ENOENT") throw e;
          }
        }
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    for (const snapshot of available) {
      if (
        count <= this.limits.maxSnapshots &&
        bytes + otherBytes <= this.limits.maxBytes
      )
        break;
      if (pinned(snapshot.version)) continue;
      bytes -= Buffer.byteLength(JSON.stringify(snapshot));
      count--;
      data.snapshots[snapshot.version] = {
        ...snapshot,
        evicted: true,
        files: [],
        sections: snapshot.sections.map(({ lines, ...rest }) => rest),
      };
    }
    if (bytes + otherBytes > this.limits.maxBytes)
      fail(
        413,
        "STORAGE_LIMIT",
        "Retained source exceeds the local storage limit. Clear historical source in Review storage and retry.",
      );
  }
  async collectBlobs() {
    if (!this.root) return;
    const used = new Set();
    for (const entry of await readdir(this.root)) {
      if (entry === "blobs") continue;
      let metadata;
      try {
        metadata = JSON.parse(
          await readFile(join(this.root, entry, "metadata.json"), "utf8"),
        );
      } catch (e) {
        if (e.code === "ENOENT") continue;
        throw e;
      }
      for (const [id, s] of Object.entries(metadata.snapshots)) {
        if (s.evicted) continue;
        const payload = JSON.parse(
          await readFile(
            join(this.root, entry, "snapshots", `${id}.json`),
            "utf8",
          ),
        );
        for (const f of payload.files || [])
          for (const side of ["before", "after"])
            if (f[`${side}TextHash`]) used.add(f[`${side}TextHash`] + ".txt");
      }
    }
    for (const file of await readdir(join(this.root, "blobs")))
      if (!used.has(file))
        await rm(join(this.root, "blobs", file), { force: true });
  }
  comparison(data, snapshot) {
    const id = digest([
      data.repository.id,
      snapshot.comparison || { kind: "working-tree" },
    ]);
    data.comparisons[id] ||= {
      id,
      spec: snapshot.comparison || { kind: "working-tree" },
      passes: [],
      activePassId: null,
      feedback: { comments: [], general: "", revision: 0 },
      batches: [],
      reports: [],
      proposals: [],
    };
    return data.comparisons[id];
  }
  async capture(snapshot, activate = false) {
    const data = await this.load(snapshot.repo.path),
      backup = structuredClone(data);
    try {
      const c = this.comparison(data, snapshot);
      snapshot.comparisonId = c.id;
      snapshot.repositoryId = data.repository.id;
      if (
        !data.snapshots[snapshot.version] ||
        data.snapshots[snapshot.version].evicted
      )
        data.snapshots[snapshot.version] = structuredClone(snapshot);
      data.leases ||= {};
      data.leases[snapshot.version] = Date.now() + this.limits.leaseMs;
      if (activate) {
        data.activeSnapshotId = snapshot.version;
        const previous = c.passes.find((p) => p.id === c.activePassId);
        if (!previous || previous.snapshotId !== snapshot.version) {
          const pass = newPass(snapshot, previous);
          const prior = previous && data.snapshots[previous.snapshotId];
          if (prior && !prior.evicted) {
            const { matches } = matchSections(prior, snapshot);
            pass.groups = (previous.groups || [])
              .map((g) => ({
                ...g,
                sections: g.sections.flatMap((id) =>
                  Object.entries(matches)
                    .filter(
                      ([, m]) => m.kind === "unchanged" && m.previousId === id,
                    )
                    .map(([id]) => id),
                ),
                explanations: {},
              }))
              .filter((g) => g.sections.length);
          }
          pass.needsUpdating = !!previous?.groups?.length;
          c.passes.push(pass);
          c.activePassId = pass.id;
        }
      }
      c.latestSnapshotId = snapshot.version;
      await this.persist(data);
      return this.decorate(snapshot);
    } catch (e) {
      this.records.set(snapshot.repo.path, backup);
      throw e;
    }
  }
  decorate(snapshot) {
    const data = this.records.get(snapshot.repo.path);
    if (!data) return snapshot;
    const c = this.comparison(data, snapshot),
      pass = c.passes.find((p) => p.id === c.activePassId);
    const prior = pass && c.passes.find((p) => p.id === pass.previousPassId),
      previous = prior && data.snapshots[prior.snapshotId];
    const changes =
      previous && !previous.evicted
        ? matchSections(previous, snapshot)
        : { matches: {}, removed: [] };
    return {
      ...snapshot,
      repositoryId: data.repository.id,
      comparisonId: c.id,
      planStatus:
        pass?.snapshotId === snapshot.version && pass.groups.length
          ? pass.needsUpdating
            ? "stale"
            : "current"
          : snapshot.planStatus,
      groups:
        pass?.snapshotId === snapshot.version ? pass.groups : snapshot.groups,
      cycle: {
        pass: structuredClone(pass || null),
        feedback: structuredClone(c.feedback),
        history: c.passes.map((p) => ({
          id: p.id,
          snapshotId: p.snapshotId,
          createdAt: p.createdAt,
          reviewed: Object.values(p.decisions).filter(
            (d) => d.status === "reviewed",
          ).length,
          available: !data.snapshots[p.snapshotId]?.evicted,
        })),
        changes,
        previousDecisions: prior?.decisions || {},
        latestSnapshotId: c.latestSnapshotId,
        proposals: structuredClone(
          c.proposals.filter((p) => p.status === "pending"),
        ),
        reports: structuredClone(c.reports),
        batches: c.batches.map(({ comments, markdown, ...b }) => ({
          ...b,
          count: comments.length,
        })),
        storage: {
          snapshots: Object.values(data.snapshots).filter((s) => !s.evicted)
            .length,
          bytes: Buffer.byteLength(JSON.stringify(data.snapshots)),
        },
      },
    };
  }
  getSnapshot(path, id) {
    const snapshot = this.records.get(path)?.snapshots[id];
    if (!snapshot) fail(404, "NOT_FOUND", "Snapshot not found.");
    if (snapshot.evicted)
      fail(
        410,
        "HISTORY_EVICTED",
        "Historical source was cleared. Comments and review records are still available.",
      );
    return structuredClone(snapshot);
  }
  async action(snapshot, action, input = {}) {
    const {
      commentInputSchema,
      commentPatchSchema,
      groupsSchema,
      outcomeSchema,
    } = await import("../shared/contracts.js");
    const data = await this.load(snapshot.repo.path),
      backup = structuredClone(data),
      c = this.comparison(data, snapshot);
    if (input.repositoryId && input.repositoryId !== data.repository.id)
      fail(409, "REPOSITORY_CHANGED", "The selected repository changed.");
    if (input.comparisonId && input.comparisonId !== c.id)
      fail(
        409,
        "COMPARISON_CHANGED",
        "The comparison changed. Reopen the intended review.",
      );
    const pass = c.passes.find((p) => p.id === c.activePassId);
    const mutationKey = input.clientMutationId
      ? `${c.id}:${input.clientMutationId}`
      : null;
    const mutationDigest = digest([action, input]);
    if (
      input.clientMutationId &&
      (typeof input.clientMutationId !== "string" ||
        input.clientMutationId.length > 160)
    )
      fail(
        422,
        "INVALID_MUTATION_ID",
        "Use a mutation ID of at most 160 characters.",
      );
    if (mutationKey && data.mutations[mutationKey]) {
      if (
        data.mutationDigests?.[mutationKey] &&
        data.mutationDigests[mutationKey] !== mutationDigest
      )
        fail(
          409,
          "MUTATION_REUSED",
          "This mutation ID was already used for a different request. Retry with a new ID.",
        );
      return structuredClone(data.mutations[mutationKey]);
    }
    let result;
    try {
      switch (action) {
        case "decision": {
          if (input.passId !== pass.id)
            fail(409, "PASS_CHANGED", "The active review pass changed.");
          if (!snapshot.sections.some((s) => s.id === input.sectionId))
            fail(404, "UNKNOWN_SECTION", "Section not found in this pass.");
          const old = pass.decisions[input.sectionId];
          revision(old, input.expectedRevision);
          if (!["pending", "reviewed", "deferred"].includes(input.status))
            fail(422, "INVALID_STATUS", "Choose a review status.");
          result = pass.decisions[input.sectionId] = {
            status: input.status,
            note: String(input.note || "").slice(0, 2000),
            revision: (old?.revision || 0) + 1,
            updatedAt: now(),
          };
          break;
        }
        case "checks": {
          if (input.passId !== pass.id)
            fail(409, "PASS_CHANGED", "The active pass changed.");
          revision(
            { revision: pass.checksRevision || 0 },
            input.expectedRevision,
          );
          if (
            !input.checks ||
            typeof input.checks !== "object" ||
            Array.isArray(input.checks) ||
            Object.entries(input.checks).some(
              ([id, values]) =>
                !snapshot.sections.some((s) => s.id === id) ||
                !Array.isArray(values) ||
                values.length > 100 ||
                values.some((n) => !Number.isInteger(n) || n < 0 || n >= 100),
            )
          )
            fail(
              422,
              "INVALID_CHECKS",
              "Checklist entries must belong to this snapshot.",
            );
          pass.checksRevision = (pass.checksRevision || 0) + 1;
          pass.checks = input.checks;
          result = pass.checks;
          break;
        }
        case "pass.restart": {
          const next = newPass(snapshot, pass);
          next.groups = structuredClone(pass.groups);
          c.passes.push(next);
          c.activePassId = next.id;
          result = next;
          break;
        }
        case "comment.create": {
          const value = commentInputSchema.parse(input);
          const existing = c.feedback.comments.find((x) => x.id === value.id);
          if (existing) {
            if (
              Object.entries(value).some(
                ([key, value]) =>
                  JSON.stringify(existing[key]) !== JSON.stringify(value),
              )
            )
              fail(
                409,
                "COMMENT_EXISTS",
                "This comment ID already exists. Save the draft as another comment.",
              );
            result = existing;
            break;
          }
          if (
            value.anchor?.path !== undefined &&
            value.anchor.path !== value.path
          )
            fail(
              422,
              "INVALID_ANCHOR",
              "The anchor must refer to the commented file.",
            );
          if (value.anchor) this.validateAnchor(data, value.anchor, c.id);
          result = {
            ...value,
            id: value.id || randomUUID(),
            comparisonId: c.id,
            status: "open",
            revision: 1,
            createdAt: now(),
            updatedAt: now(),
          };
          c.feedback.comments.push(result);
          break;
        }
        case "comment.update":
        case "comment.delete": {
          const comment = c.feedback.comments.find((x) => x.id === input.id);
          if (!comment) fail(404, "NOT_FOUND", "Comment not found.");
          revision(comment, input.expectedRevision);
          if (action === "comment.delete") {
            c.feedback.comments = c.feedback.comments.filter(
              (x) => x.id !== input.id,
            );
            result = { deleted: true };
            break;
          }
          const patch = commentPatchSchema.parse(input.patch);
          if (Object.hasOwn(patch, "anchor"))
            comment.originalAnchor ||= comment.anchor;
          if (patch.anchor) {
            if (patch.anchor.path !== comment.path)
              fail(
                422,
                "INVALID_ANCHOR",
                "The anchor must refer to the commented file.",
              );
            this.validateAnchor(data, patch.anchor, c.id);
            comment.originalAnchor ||= comment.anchor;
          }
          const edited = ["text", "intent", "section", "anchor"].some((k) =>
            Object.hasOwn(patch, k),
          );
          Object.assign(comment, patch, {
            status: edited ? "open" : patch.status || comment.status,
            revision: comment.revision + 1,
            updatedAt: now(),
          });
          if (patch.anchor === null) delete comment.anchor;
          if (patch.section === null) delete comment.section;
          result = comment;
          break;
        }
        case "general": {
          revision(c.feedback, input.expectedRevision);
          c.feedback.general = String(input.text || "").slice(0, 50000);
          c.feedback.revision++;
          result = c.feedback;
          break;
        }
        case "import": {
          const key =
            String(input.installationId || "legacy") +
            ":" +
            digest(input.feedback || {});
          if (!data.imports[key]) {
            for (const candidate of input.feedback?.comments || []) {
              const parsed = commentInputSchema.safeParse(candidate);
              if (!parsed.success) continue;
              let value = parsed.data;
              const existing = c.feedback.comments.find(
                (x) => x.id === value.id,
              );
              if (existing && existing.text === value.text) continue;
              if (existing) value = { ...value, id: randomUUID() };
              c.feedback.comments.push({
                ...value,
                id: value.id || randomUUID(),
                comparisonId: c.id,
                status: "open",
                revision: 1,
                createdAt: now(),
                updatedAt: now(),
              });
            }
            if (!c.feedback.general)
              c.feedback.general = String(input.feedback?.general || "").slice(
                0,
                50000,
              );
            if (
              input.review?.version === snapshot.version &&
              !Object.keys(pass.decisions).length
            )
              for (const id of input.review.reviewed || [])
                if (snapshot.sections.some((s) => s.id === id))
                  pass.decisions[id] = {
                    status: "reviewed",
                    revision: 1,
                    updatedAt: now(),
                  };
            if (
              input.review?.version &&
              input.review.version !== snapshot.version
            ) {
              data.legacyReviews ||= {};
              data.legacyReviews[key] = input.review;
            }
            data.imports[key] = now();
          }
          result = { imported: true };
          break;
        }
        case "batch.publish": {
          const ids = new Set(input.commentIds || []),
            comments = c.feedback.comments.filter(
              (x) => ids.has(x.id) && x.text.trim(),
            );
          const general = input.includeGeneral ? c.feedback.general : "";
          if (!comments.length && !general.trim())
            fail(
              422,
              "EMPTY_BATCH",
              "Select comments or general instructions.",
            );
          const files = [...new Set(comments.map((c) => c.path))]
            .sort()
            .map((path) => ({
              path,
              comments: comments.filter((c) => c.path === path),
            }));
          const markdown = formatPrompt(
            snapshot,
            files,
            general,
            (comment, w) =>
              !w.sections.some((s) => s.path === comment.path)
                ? "missing-file"
                : (comment.anchor && comment.anchor.snapshotId !== w.version) ||
                    (comment.section &&
                      !w.sections.some(
                        (s) =>
                          s.id === comment.section.id &&
                          s.path === comment.path,
                      ))
                  ? "stale-section"
                  : "current",
          );
          result = {
            id: randomUUID(),
            comparisonId: c.id,
            snapshotId: snapshot.version,
            passId: pass.id,
            comments: structuredClone(comments),
            general,
            markdown,
            status: "published",
            createdAt: now(),
          };
          if (Buffer.byteLength(JSON.stringify(result)) > 2 * 1024 * 1024)
            fail(
              413,
              "BATCH_TOO_LARGE",
              "Publish a smaller file selection (maximum 2 MiB per batch).",
            );
          c.batches.push(result);
          break;
        }
        case "batch.list":
          return c.batches
            .filter((b) => b.status === "published")
            .map(({ comments, markdown, general, ...b }) => ({
              ...b,
              count: comments.length,
            }));
        case "batch.get": {
          const batch = c.batches.find(
            (b) => b.id === input.id && b.status === "published",
          );
          if (!batch) fail(404, "NOT_FOUND", "Published batch not found.");
          return structuredClone(batch);
        }
        case "batch.revoke": {
          const batch = c.batches.find((b) => b.id === input.id);
          if (!batch) fail(404, "NOT_FOUND", "Batch not found.");
          batch.status = "revoked";
          result = { revoked: true };
          break;
        }
        case "batch.report": {
          const batch = c.batches.find(
            (b) => b.id === input.id && b.status === "published",
          );
          if (!batch) fail(404, "NOT_FOUND", "Published batch not found.");
          const inspected = data.snapshots[input.snapshotId];
          if (!inspected || inspected.comparisonId !== c.id)
            fail(
              409,
              "WRONG_SNAPSHOT",
              "Read a snapshot for this comparison first.",
            );
          if (!Array.isArray(input.outcomes) || input.outcomes.length > 100)
            fail(422, "INVALID_OUTCOMES", "Report at most 100 outcomes.");
          result = [];
          for (const value of input.outcomes) {
            const outcome = outcomeSchema.parse(value),
              captured = batch.comments.find((x) => x.id === outcome.commentId);
            if (!captured)
              fail(422, "UNKNOWN_COMMENT", "Comment is not in this batch.");
            if (
              outcome.sectionIds?.some(
                (id) => !inspected.sections.some((s) => s.id === id),
              )
            )
              fail(
                422,
                "UNKNOWN_SECTION",
                "Report contains an unknown section.",
              );
            const report = {
              ...outcome,
              id: randomUUID(),
              batchId: batch.id,
              commentRevision: captured.revision,
              snapshotId: input.snapshotId,
              createdAt: now(),
            };
            c.reports.push(report);
            result.push(report);
            const comment = c.feedback.comments.find(
              (x) => x.id === captured.id,
            );
            if (
              comment &&
              comment.revision === captured.revision &&
              comment.status !== "resolved" &&
              outcome.outcome === "addressed"
            ) {
              comment.status = "addressed";
              comment.revision++;
              comment.updatedAt = now();
            }
          }
          break;
        }
        case "plan.save": {
          revision({ revision: pass.planRevision }, input.expectedRevision);
          const groups = groupsSchema.parse(input.groups);
          this.validateGroups(snapshot, groups);
          pass.planHistory.push({
            revision: pass.planRevision,
            groups: pass.groups,
          });
          pass.groups = groups;
          pass.planRevision++;
          pass.needsUpdating = false;
          result = pass;
          break;
        }
        case "plan.propose": {
          const target = this.getSnapshot(snapshot.repo.path, input.snapshotId);
          if (target.comparisonId !== c.id)
            fail(
              409,
              "WRONG_COMPARISON",
              "Proposal belongs to another comparison.",
            );
          const groups = groupsSchema.parse(input.groups);
          this.validateGroups(target, groups);
          const key = digest([input.snapshotId, groups]);
          const existing = c.proposals.find((p) => p.key === key);
          if (existing) {
            if (
              Object.entries(value).some(
                ([key, value]) =>
                  JSON.stringify(existing[key]) !== JSON.stringify(value),
              )
            )
              fail(
                409,
                "COMMENT_EXISTS",
                "This comment ID already exists. Save the draft as another comment.",
              );
            result = existing;
            break;
          }
          result = {
            id: randomUUID(),
            key,
            snapshotId: input.snapshotId,
            groups,
            status: "pending",
            createdAt: now(),
            expectedPlanRevision: pass.planRevision,
          };
          if (target.version === snapshot.version && !pass.groups.length) {
            pass.groups = groups;
            pass.planRevision++;
            pass.needsUpdating = false;
            result.status = "accepted";
          }
          c.proposals.push(result);
          break;
        }
        case "plan.accept":
        case "plan.dismiss": {
          const proposal = c.proposals.find(
            (p) => p.id === input.id && p.status === "pending",
          );
          if (!proposal) fail(404, "NOT_FOUND", "Pending proposal not found.");
          if (action === "plan.accept") {
            revision({ revision: pass.planRevision }, input.expectedRevision);
            if (proposal.snapshotId !== snapshot.version)
              fail(
                409,
                "SNAPSHOT_CHANGED",
                "Activate the proposed snapshot before accepting this plan.",
              );
            pass.planHistory.push({
              revision: pass.planRevision,
              groups: pass.groups,
            });
            pass.groups = proposal.groups;
            pass.planRevision++;
            pass.needsUpdating = false;
          }
          proposal.status = action === "plan.accept" ? "accepted" : "dismissed";
          result = proposal;
          break;
        }
        case "pass.changes": {
          const requested = c.passes.find((p) => p.id === input.passId);
          if (!requested) fail(404, "NOT_FOUND", "Review pass not found.");
          const previous = c.passes.find(
            (p) => p.id === requested.previousPassId,
          );
          const currentSnapshot = data.snapshots[requested.snapshotId],
            previousSnapshot = previous && data.snapshots[previous.snapshotId];
          if (currentSnapshot?.evicted || previousSnapshot?.evicted)
            return { matches: {}, removed: [], unavailable: true };
          return matchSections(previousSnapshot, currentSnapshot);
        }
        case "history":
          return {
            passes: c.passes,
            snapshots: Object.values(data.snapshots)
              .filter((s) => s.comparisonId === c.id)
              .map((s) => ({
                version: s.version,
                capturedAt: s.capturedAt,
                evicted: !!s.evicted,
              })),
          };
        case "storage.reset": {
          if (input.confirmRepository !== snapshot.repo.name)
            fail(
              422,
              "CONFIRM_REPOSITORY",
              "Type the repository name to delete its review data.",
            );
          data.comparisons = {};
          data.mutations = {};
          for (const [id, s] of Object.entries(data.snapshots))
            if (id !== snapshot.version)
              data.snapshots[id] = {
                ...s,
                evicted: true,
                files: [],
                sections: s.sections.map(({ lines, ...rest }) => rest),
              };
          const fresh = this.comparison(data, snapshot),
            next = newPass(snapshot);
          fresh.passes = [next];
          fresh.activePassId = next.id;
          fresh.latestSnapshotId = snapshot.version;
          data.activeSnapshotId = snapshot.version;
          result = { reset: true };
          break;
        }
        case "storage.clear": {
          for (const [id, s] of Object.entries(data.snapshots))
            if (id !== data.activeSnapshotId) {
              data.snapshots[id] = {
                ...s,
                evicted: true,
                files: [],
                sections: s.sections.map(({ lines, ...rest }) => rest),
              };
            }
          result = { cleared: true };
          break;
        }
        default:
          fail(404, "UNKNOWN_ACTION", "Unknown review operation.");
      }
      if (mutationKey) {
        data.mutations[mutationKey] = structuredClone(result);
        data.mutationDigests ||= {};
        data.mutationDigests[mutationKey] = mutationDigest;
        const keys = Object.keys(data.mutations);
        for (const key of keys.slice(0, Math.max(0, keys.length - 2000))) {
          delete data.mutations[key];
          delete data.mutationDigests[key];
        }
      }
      await this.persist(data);
      return structuredClone(result);
    } catch (e) {
      this.records.set(snapshot.repo.path, backup);
      throw e;
    }
  }
  validateGroups(snapshot, groups) {
    const ids = new Set();
    for (const g of groups) {
      if (ids.has(g.id))
        fail(422, "DUPLICATE_GROUP", "Group IDs must be unique.");
      ids.add(g.id);
      if (
        new Set(g.sections).size !== g.sections.length ||
        g.sections.some((id) => !snapshot.sections.some((s) => s.id === id))
      )
        fail(
          422,
          "UNKNOWN_SECTION",
          "Groups must contain unique, existing sections.",
        );
      if (Object.keys(g.explanations).some((id) => !g.sections.includes(id)))
        fail(
          422,
          "INVALID_EXPLANATION",
          "Explanations must reference group sections.",
        );
    }
  }
  validateAnchor(data, anchor, comparisonId) {
    const s = data.snapshots[anchor.snapshotId];
    if (s && s.comparisonId !== comparisonId)
      fail(422, "INVALID_ANCHOR", "Anchor belongs to another comparison.");
    if (!s || s.evicted)
      fail(410, "HISTORY_EVICTED", "The captured source is unavailable.");
    const f = s.files.find(
      (f) => f.id === anchor.fileId && f.path === anchor.path,
    );
    if (!f) fail(422, "INVALID_ANCHOR", "Choose a file from this snapshot.");
    if (anchor.startLine) {
      const text = f[`${anchor.side}Text`];
      if (typeof text !== "string")
        fail(422, "INVALID_ANCHOR", "Text is unavailable on this side.");
      const rows = text.split("\n");
      if (anchor.endLine > rows.length)
        fail(422, "INVALID_ANCHOR", "The selection is outside the file.");
      anchor.quote = rows
        .slice(anchor.startLine - 1, anchor.endLine)
        .join("\n");
      if (Buffer.byteLength(anchor.quote) > 16384)
        fail(413, "ANCHOR_LIMIT", "Select no more than 16 KiB of text.");
    }
  }
}
