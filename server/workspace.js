import { acquireDataLock } from "./data-lock.js";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { readRepository } from "./git.js";
import { ReviewStore, cycleError } from "./review-store.js";
import { EventEmitter } from "node:events";

export class WorkspaceStore extends EventEmitter {
  #current = null;
  #plan = null;
  #recent = [];
  #queue = Promise.resolve();
  revision = 0;
  constructor({ stateFile = null, reviewLimits = {} } = {}) {
    super();
    this.stateFile = stateFile;
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
      if (!saved.path) return;
      if (saved.schemaVersion === 2 && saved.snapshotId) {
        const fresh = await readRepository(
          saved.path,
          saved.comparison || { kind: "working-tree" },
        );
        await this.reviews.load(fresh.repo.path);
        try {
          this.#current = this.reviews.getSnapshot(
            fresh.repo.path,
            saved.snapshotId,
          );
        } catch {
          this.#current = fresh;
          await this.reviews.capture(fresh, true);
        }
        await this.reviews.capture(fresh, false);
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
        }),
        { mode: 0o600 },
      );
      await rename(temporary, this.stateFile);
    }
    this.emit("revision", this.revision);
  }
  connect(path, { recordRecent = true } = {}) {
    return this.run(async () => {
      let snapshot = await readRepository(path);
      snapshot = await this.reviews.capture(snapshot, true);
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
        await this.persist();
      } catch (error) {
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
      if (this.#recent.length === previous.length) return;
      this.revision++;
      try {
        await this.persist();
      } catch (error) {
        this.#recent = previous;
        this.revision--;
        throw error;
      }
    });
  }
  disconnect() {
    return this.run(async () => {
      this.#current = null;
      this.#plan = null;
      this.revision++;
      await this.persist();
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
  refresh() {
    return this.run(() => this.updateFromGit());
  }
  capture(source = "agent") {
    return this.run(async () => {
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
  cycleAction(action, input) {
    return this.run(async () => {
      if (!this.#current) throw new Error("Open a repository first.");
      const result = await this.reviews.action(this.#current, action, input);
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
        expectedPassId !== this.snapshot().cycle.pass.id
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
