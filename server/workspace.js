import { HandoffQueue, planReceipt } from "./handoff-queue.js";
import { acquireDataLock } from "./data-lock.js";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { readRepository, repositoryRoot } from "./git.js";
import { ReviewStore, cycleError, validateGroups } from "./review-store.js";
import { EventEmitter } from "node:events";

export class WorkspaceStore extends EventEmitter {
  #current = null;
  #plan = null;
  #recent = [];
  #registry = new Map();
  importErrors = [];
  #queue = Promise.resolve();
  revision = 0;
  constructor({ stateFile = null, reviewLimits = {} } = {}) {
    super();
    this.stateFile = stateFile;
    this.inbox = stateFile ? new HandoffQueue(dirname(stateFile)) : null;
    this.reviews = new ReviewStore(stateFile, reviewLimits);
  }
  async acquire() {
    this.releaseLock ||= await acquireDataLock(this.stateFile);
  }
  async close() {
    await this.releaseLock?.();
    this.releaseLock = null;
  }
  snapshot() {
    return this.#current ? this.reviews.decorate(this.#current) : null;
  }
  get recentRepositories() {
    return this.#recent.map((repo) => ({ ...repo }));
  }
  get repositories() {
    return [...this.#registry.values()]
      .filter((repo) => !repo.hidden)
      .sort(
        (a, b) =>
          Number(!!b.unseen) - Number(!!a.unseen) ||
          (b.unseen ? (b.activityAt || 0) - (a.activityAt || 0) : 0) ||
          (b.viewedAt || 0) - (a.viewedAt || 0),
      );
  }
  #remember(snapshot, changes = {}) {
    const { path, name, branch } = snapshot.repo;
    this.#registry.set(path, {
      ...this.#registry.get(path),
      name,
      path,
      branch,
      repositoryId: snapshot.repositoryId,
      ...changes,
    });
  }
  async #savedSnapshot(path, comparisonId) {
    const data = await this.reviews.load(path);
    let id = data.activeSnapshotId;
    if (comparisonId) {
      const comparison = data.comparisons[comparisonId];
      id = comparison?.passes.find(
        (p) => p.id === comparison.activePassId,
      )?.snapshotId;
    }
    return id ? this.reviews.getSnapshot(path, id) : null;
  }
  async checkoutSnapshot(repositoryId, comparisonId) {
    if (!repositoryId) return this.snapshot();
    if (
      this.#current?.repositoryId === repositoryId &&
      (!comparisonId || this.#current.comparisonId === comparisonId)
    )
      return this.snapshot();
    const path = await this.#agentPath({ repositoryId });
    const saved = await this.#savedSnapshot(path, comparisonId);
    if (!saved)
      throw cycleError(
        404,
        "UNKNOWN_COMPARISON",
        "This checkout has no matching review.",
      );
    return this.reviews.decorate(saved);
  }
  async #agentPath({ repositoryPath, repositoryId }) {
    if (repositoryPath) {
      if (
        this.#registry.has(repositoryPath) ||
        this.reviews.records.has(repositoryPath)
      )
        return repositoryPath;
      return repositoryRoot(repositoryPath);
    }
    if (repositoryId) {
      const entry = [...this.#registry.values()].find(
        (r) => r.repositoryId === repositoryId,
      );
      if (!entry)
        throw cycleError(
          404,
          "UNKNOWN_CHECKOUT",
          "Unknown checkout. Supply its repositoryPath.",
        );
      return entry.path;
    }
    const paths = new Set(this.repositories.map((r) => r.path));
    if (this.#current) paths.add(this.#current.repo.path);
    if (paths.size !== 1)
      throw cycleError(
        409,
        "CHECKOUT_REQUIRED",
        "Supply repositoryPath to identify your local checkout.",
      );
    return paths.values().next().value;
  }
  agentContext(input) {
    return this.run(async () => {
      const path = await this.#agentPath(input);
      const visible = await this.#savedSnapshot(path, input.comparisonId);
      const data = this.reviews.records.get(path);
      if (
        (input.repositoryId && input.repositoryId !== data.repository.id) ||
        (input.comparisonId && !data.comparisons[input.comparisonId])
      )
        throw cycleError(
          409,
          "WRONG_CAPTURE",
          "The requested checkout or comparison does not match this path.",
        );
      let raw;
      if (input.snapshotId) {
        raw = this.reviews.getSnapshot(path, input.snapshotId);
      } else {
        raw = await readRepository(path, visible?.comparison);
        const oldLatest =
          visible && this.reviews.decorate(visible).cycle.latestSnapshotId;
        await this.reviews.capture(raw, false);
        if (visible && oldLatest !== raw.version) {
          this.emit("revision", ++this.revision, "snapshot-available", raw);
        }
      }
      if (
        (input.repositoryId && input.repositoryId !== raw.repositoryId) ||
        (input.comparisonId && input.comparisonId !== raw.comparisonId)
      )
        throw cycleError(
          409,
          "WRONG_CAPTURE",
          "The capture belongs to a different checkout or comparison.",
        );
      this.inbox?.capture(raw);
      return {
        snapshot: this.reviews.decorate(raw),
        visibleSnapshotId: visible?.version || null,
      };
    });
  }
  agentPlan(input) {
    return this.run(async () => {
      // A staged capture is already bound to its canonical checkout, even if
      // the checkout was removed between capture and the app starting.
      const stagedPath = this.inbox?.pathFor(input.snapshotId);
      const path =
        stagedPath &&
        (!input.repositoryPath || input.repositoryPath === stagedPath)
          ? stagedPath
          : await this.#agentPath(input);
      await this.reviews.load(path);
      let snapshot;
      try {
        snapshot = this.reviews.getSnapshot(path, input.snapshotId);
      } catch (error) {
        if (![404, 410].includes(error.status)) throw error;
        snapshot = this.inbox?.read(input.snapshotId, path);
        if (!snapshot) throw error;
      }
      return this.#deliver(snapshot, input.groups);
    });
  }
  async #deliver(snapshot, groups) {
    const { groupsSchema } = await import("../shared/contracts.js");
    groups = groupsSchema.min(1).parse(groups);
    if (groups.some((group) => !group.sections.length))
      throw new Error("Each behavior needs at least one section.");
    validateGroups(snapshot, groups);
    const path = snapshot.repo.path;
    const data = await this.reviews.load(path);
    const comparison = this.reviews.comparison(data, snapshot);
    const pass = comparison.passes.find(
      (p) => p.id === comparison.activePassId,
    );
    const display = pass
      ? this.reviews.getSnapshot(path, pass.snapshotId)
      : snapshot;
    if (
      !data.snapshots[snapshot.version] ||
      data.snapshots[snapshot.version].evicted ||
      !pass
    ) {
      const previousActive = data.activeSnapshotId;
      await this.reviews.capture(snapshot, !pass);
      // Bootstrapping another comparison must preserve the user's last comparison.
      if (!pass && previousActive) data.activeSnapshotId = previousActive;
    }
    const receipt = planReceipt(snapshot.version, groups);
    const proposal = await this.reviews.action(display, "plan.propose", {
      snapshotId: snapshot.version,
      groups,
      clientMutationId: receipt,
    });
    await this.#activity(
      {
        repo: snapshot.repo,
        repositoryId: data.repository.id,
        comparisonId: comparison.id,
      },
      "Plan ready",
      proposal.id,
      proposal.createdAt,
    );
    return proposal;
  }
  async #activity(snapshot, activity, id, at) {
    const old = this.#registry.get(snapshot.repo.path);
    const activityAt = Date.parse(at);
    if (old?.activityId === id || old?.activityAt > activityAt) return;
    this.#remember(snapshot, {
      activity,
      activityAt,
      activityId: id,
      activityComparisonId: snapshot.comparisonId,
      unseen: true,
      hidden: false,
    });
    try {
      await this.persistIndex("checkout-activity", snapshot);
    } catch (error) {
      if (old) this.#registry.set(old.path, old);
      else this.#registry.delete(snapshot.repo.path);
      throw error;
    }
  }
  agentFeedback(action, input) {
    return this.run(async () => {
      const path = await this.#agentPath(input);
      const snapshot = await this.#savedSnapshot(path, input.comparisonId);
      if (!snapshot)
        throw cycleError(
          404,
          "UNKNOWN_COMPARISON",
          "Open the originating comparison in Ordiff.",
        );
      const { repositoryPath, ...body } = input;
      const result = await this.reviews.action(snapshot, action, body);
      if (action === "batch.report" && result.length) {
        await this.#activity(
          snapshot,
          "Feedback report",
          result[0].id,
          result[0].createdAt,
        );
      }
      return result;
    });
  }
  importHandoffs() {
    return this.run(async () => {
      const previousErrors = this.importErrors;
      this.importErrors = [];
      for (const { receipt, path } of this.inbox?.pending() || []) {
        try {
          const { snapshot, groups } = this.inbox.get(receipt);
          await this.#deliver(snapshot, groups);
          this.inbox.acknowledge(receipt);
        } catch (error) {
          this.importErrors.push({ receipt, path, message: error.message });
        }
      }
      if (JSON.stringify(previousErrors) !== JSON.stringify(this.importErrors))
        this.emit("revision", ++this.revision);
      return this.importErrors;
    });
  }
  run(operation) {
    const pending = this.#queue.then(operation);
    this.#queue = pending.catch(() => {});
    return pending;
  }
  async restore() {
    if (!this.stateFile) return;
    try {
      const saved = JSON.parse(await readFile(this.stateFile, "utf8"));
      const history = Array.isArray(saved.recentRepositories)
        ? saved.recentRepositories
        : [];
      const seen = new Set();
      this.#recent = history
        .filter((repo) => {
          if (
            !repo ||
            typeof repo.path !== "string" ||
            !isAbsolute(repo.path) ||
            typeof repo.name !== "string" ||
            !repo.name ||
            seen.has(repo.path)
          )
            return false;
          seen.add(repo.path);
          return true;
        })
        .slice(0, 10)
        .map(({ name, path }) => ({ name, path }));
      if (saved.schemaVersion && saved.schemaVersion !== 2)
        throw Object.assign(
          new Error(
            "Unsupported workspace schema. Use a compatible Ordiff version.",
          ),
          { code: "UNSUPPORTED_SCHEMA" },
        );
      for (const repo of saved.repositories || this.#recent) {
        if (
          repo &&
          typeof repo.path === "string" &&
          isAbsolute(repo.path) &&
          repo.name
        )
          this.#registry.set(repo.path, repo);
      }
      if (!saved.path) return;
      if (saved.schemaVersion === 2 && saved.snapshotId) {
        await this.reviews.load(saved.path);
        try {
          this.#current = this.reviews.getSnapshot(
            saved.path,
            saved.snapshotId,
          );
        } catch (error) {
          if (![404, 410].includes(error.status)) throw error;
        }
        let fresh;
        try {
          fresh = await readRepository(saved.path, saved.comparison);
        } catch (error) {
          // A saved review can outlive its branch or checkout.
          if (!this.#current) throw error;
        }
        if (fresh) {
          await this.reviews.capture(fresh, !this.#current);
          this.#current ||= fresh;
        }
        this.#remember(this.#current, {
          comparison: this.#current.comparison,
          comparisonId: this.#current.comparisonId,
        });
        this.revision++;
        return;
      }
      try {
        await writeFile(`${this.stateFile}.v1.backup`, JSON.stringify(saved), {
          flag: "wx",
          mode: 0o600,
        });
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      await this.connect(saved.path, {
        recordRecent: !Array.isArray(saved.recentRepositories),
      });
      if (saved.plan?.version === this.#current.version) {
        // connect() just read Git. Restore against that snapshot without scanning it again.
        await this.run(async () => {
          this.#applyPlan(this.#current, saved.plan);
          await this.persist();
        });
      }
    } catch (error) {
      if (
        error.code !== "ENOENT" &&
        !/repository|directory/i.test(error.message)
      )
        throw error;
    }
  }
  async persist() {
    if (this.#current) {
      const data = this.reviews.records.get(this.#current.repo.path);
      if (data) await this.reviews.persist(data);
    }
    if (this.#current)
      this.#remember(this.#current, {
        comparison: this.#current.comparison,
        comparisonId: this.#current.comparisonId,
      });
    await this.persistIndex();
  }
  async persistIndex(type, target) {
    if (this.stateFile) {
      await mkdir(dirname(this.stateFile), { recursive: true });
      const temporary = `${this.stateFile}.tmp`;
      await writeFile(
        temporary,
        JSON.stringify({
          schemaVersion: 2,
          snapshotId: this.#current?.version || null,
          comparison: this.#current?.comparison || null,
          path: this.#current?.repo.path || null,
          plan: this.#plan,
          recentRepositories: this.#recent,
          repositories: [...this.#registry.values()],
        }),
        { mode: 0o600 },
      );
      await rename(temporary, this.stateFile);
    }
    if (type) this.revision++;
    this.emit("revision", this.revision, type, target);
  }
  connect(
    path,
    { recordRecent = true, observedActivityId, comparisonId } = {},
  ) {
    return this.run(async () => {
      const root = this.#registry.has(path) ? path : await repositoryRoot(path);
      let snapshot = await this.#savedSnapshot(
        root,
        comparisonId || this.#registry.get(root)?.comparisonId,
      );
      if (comparisonId && !snapshot)
        throw cycleError(
          404,
          "UNKNOWN_COMPARISON",
          "This comparison is unavailable.",
        );
      if (!snapshot)
        snapshot = await this.reviews.capture(await readRepository(root), true);
      const registry = new Map(this.#registry);
      const entry = this.#registry.get(root);
      const unseen =
        !!entry?.unseen &&
        ((observedActivityId !== undefined &&
          observedActivityId !== entry.activityId) ||
          (!!entry.activityComparisonId &&
            entry.activityComparisonId !== snapshot.comparisonId));
      const data = this.reviews.records.get(root);
      const previousActive = data.activeSnapshotId;
      data.activeSnapshotId = snapshot.version;
      this.#remember(snapshot, {
        viewedAt: Date.now(),
        unseen,
        hidden: false,
        comparison: snapshot.comparison,
        comparisonId: snapshot.comparisonId,
      });
      const previous = {
        current: this.#current,
        plan: this.#plan,
        recent: this.#recent,
        revision: this.revision,
      };
      const same =
        this.#current?.repo.path === snapshot.repo.path &&
        this.#current.version === snapshot.version;
      if (!same) {
        if (this.#current?.repo.path === snapshot.repo.path && this.#plan)
          snapshot.planStatus = "stale";
        this.#current = snapshot;
        this.#plan = null;
      }
      if (recordRecent)
        this.#recent = [
          { name: snapshot.repo.name, path: snapshot.repo.path },
          ...this.#recent.filter((repo) => repo.path !== snapshot.repo.path),
        ].slice(0, 10);
      if (same && !recordRecent) return this.#current;
      this.revision++;
      try {
        if (previousActive !== snapshot.version)
          await this.reviews.persist(data);
        await this.persistIndex();
      } catch (error) {
        data.activeSnapshotId = previousActive;
        this.#registry = registry;
        this.#current = previous.current;
        this.#plan = previous.plan;
        this.#recent = previous.recent;
        this.revision = previous.revision;
        throw error;
      }
      return this.#current;
    });
  }
  removeRecentRepository(path) {
    return this.run(async () => {
      if (typeof path !== "string" || !path)
        throw new Error("Choose a recent repository to remove.");
      const previous = this.#recent;
      this.#recent = previous.filter((repo) => repo.path !== path);
      const entry = this.#registry.get(path);
      if (this.#recent.length === previous.length && (!entry || entry.hidden))
        return;
      if (entry) this.#registry.set(path, { ...entry, hidden: true });
      this.revision++;
      try {
        await this.persistIndex();
      } catch (error) {
        this.#recent = previous;
        if (entry) this.#registry.set(path, entry);
        this.revision--;
        throw error;
      }
    });
  }
  disconnect(repositoryId) {
    return this.run(async () => {
      this.checkSelection(repositoryId);
      this.#current = null;
      this.#plan = null;
      this.revision++;
      await this.persistIndex();
    });
  }
  async updateFromGit() {
    if (!this.#current) throw new Error("Open a repository in Ordiff first.");
    let snapshot = await readRepository(
      this.#current.repo.path,
      this.#current.comparison,
    );
    snapshot = await this.reviews.capture(snapshot, true);
    if (snapshot.version !== this.#current.version) {
      snapshot.planStatus =
        this.#plan || this.#current.planStatus === "stale" ? "stale" : "none";
      this.#current = snapshot;
      this.#plan = null;
      this.revision++;
      await this.persist();
    }
    return this.#current;
  }
  checkSelection(repositoryId, comparisonId) {
    if (
      (repositoryId && repositoryId !== this.#current?.repositoryId) ||
      (comparisonId && comparisonId !== this.#current?.comparisonId)
    )
      throw cycleError(
        409,
        "WORKSPACE_CHANGED",
        "The selected review changed. Reopen the intended checkout.",
      );
  }
  refresh(repositoryId, comparisonId) {
    return this.run(() => {
      this.checkSelection(repositoryId, comparisonId);
      return this.updateFromGit();
    });
  }
  capture(source = "agent", expected) {
    return this.run(async () => {
      this.checkSelection(expected?.repositoryId, expected?.comparisonId);
      if (!this.#current) throw new Error("Open a repository first.");
      const snapshot = await readRepository(
        this.#current.repo.path,
        this.#current.comparison,
      );
      const latest = this.snapshot().cycle.latestSnapshotId;
      const captured = await this.reviews.capture(snapshot, false);
      if (latest !== snapshot.version) {
        this.revision++;
        this.emit(
          "revision",
          this.revision,
          source === "detector"
            ? "source-change-available"
            : "snapshot-available",
        );
      }
      return captured;
    });
  }
  cycleAction(action, input, target) {
    return this.run(async () => {
      const snapshot = target
        ? await this.#savedSnapshot(target.repo.path, target.comparisonId)
        : this.#current;
      if (!snapshot) throw new Error("Open a repository first.");
      const result = await this.reviews.action(snapshot, action, input);
      if (
        !["batch.get", "batch.list", "history", "pass.changes"].includes(action)
      ) {
        this.revision++;
        this.emit(
          "revision",
          this.revision,
          action === "plan.propose"
            ? "plan-proposed"
            : action === "plan.accept"
              ? "plan-accepted"
              : action.startsWith("comment") ||
                  action.startsWith("batch") ||
                  action === "general"
                ? "feedback-updated"
                : "review-updated",
          snapshot,
        );
      }
      return result;
    });
  }
  selectComparison(spec, repositoryId) {
    return this.run(async () => {
      if (!this.#current) throw new Error("Open a repository first.");
      if (repositoryId && repositoryId !== this.snapshot().repositoryId)
        throw cycleError(
          409,
          "REPOSITORY_CHANGED",
          "The selected repository changed.",
        );
      const snapshot = await readRepository(this.#current.repo.path, spec);
      await this.reviews.capture(snapshot, true);
      this.#current = snapshot;
      this.#plan = null;
      this.revision++;
      await this.persist();
      return this.snapshot();
    });
  }
  activateSnapshot(id, expectedPassId) {
    return this.run(async () => {
      if (
        expectedPassId !== undefined &&
        expectedPassId !== this.snapshot()?.cycle.pass.id
      )
        throw cycleError(409, "PASS_CHANGED", "The active pass changed.");
      const snapshot = this.reviews.getSnapshot(this.#current.repo.path, id);
      if (snapshot.comparisonId !== this.snapshot().comparisonId)
        throw new Error("Snapshot belongs to another comparison.");
      await this.reviews.capture(snapshot, true);
      this.#current = snapshot;
      this.#plan = null;
      this.revision++;
      await this.persist();
      return this.snapshot();
    });
  }
  submitPlan(plan) {
    return this.run(async () => {
      const snapshot = await this.updateFromGit();
      this.#applyPlan(snapshot, plan);
      await this.persist();
      return this.#current;
    });
  }
  #applyPlan(snapshot, plan) {
    if (plan.version !== snapshot.version)
      throw new Error(
        "The diff changed. Read the current context and submit a plan for the new version.",
      );
    if (
      !Array.isArray(plan.groups) ||
      !plan.groups.length ||
      plan.groups.length > 100
    )
      throw new Error("A review plan needs between 1 and 100 behavior groups.");
    const validIds = new Set(snapshot.sections.map((section) => section.id));
    const groupIds = new Set();
    const groups = plan.groups.map((group) => {
      if (
        typeof group.id !== "string" ||
        !/^[a-zA-Z0-9_-]{1,80}$/.test(group.id) ||
        groupIds.has(group.id)
      )
        throw new Error("Behavior identifiers must be unique simple names.");
      if (
        typeof group.title !== "string" ||
        !group.title.trim() ||
        group.title.length > 160 ||
        typeof group.description !== "string" ||
        group.description.length > 1000
      )
        throw new Error("Each behavior needs a short title and description.");
      if (
        !Array.isArray(group.steps) ||
        !group.steps.length ||
        group.steps.length > 500
      )
        throw new Error("Each behavior needs at least one step.");
      groupIds.add(group.id);
      const seen = new Set();
      const explanations = {};
      for (const step of group.steps) {
        if (!validIds.has(step.sectionId))
          throw new Error(`Unknown diff section: ${step.sectionId}`);
        if (seen.has(step.sectionId))
          throw new Error("A behavior cannot repeat the same section.");
        if (
          typeof step.explanation !== "string" ||
          step.explanation.length > 2000
        )
          throw new Error("Step explanations must be short text.");
        seen.add(step.sectionId);
        explanations[step.sectionId] = step.explanation;
      }
      return {
        id: group.id,
        title: group.title,
        short: group.title,
        description: group.description,
        sections: [...seen],
        explanations,
      };
    });
    const data = this.reviews.records.get(snapshot.repo.path);
    if (data) {
      const comparison = this.reviews.comparison(data, snapshot);
      const pass = comparison.passes.find(
        (p) => p.id === comparison.activePassId,
      );
      if (pass) {
        pass.groups = groups;
        pass.planRevision++;
      }
    }
    this.#plan = plan;
    this.#current = {
      ...snapshot,
      groups,
      planStatus: "current",
      sections: snapshot.sections.map((section) => ({
        ...section,
        group:
          groups.find((group) => group.sections.includes(section.id))?.id ||
          null,
      })),
    };
    this.revision++;
  }
}
