import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { readRepository } from './git.js';

export class WorkspaceStore {
  #current = null;
  #plan = null;
  #queue = Promise.resolve();
  revision = 0;
  constructor({ stateFile = null } = {}) { this.stateFile = stateFile; }
  snapshot() { return this.#current; }
  run(operation) { const pending = this.#queue.then(operation); this.#queue = pending.catch(() => {}); return pending; }
  async restore() {
    if (!this.stateFile) return;
    try { const saved = JSON.parse(await readFile(this.stateFile, 'utf8')); if (!saved.path) return; await this.connect(saved.path); if (saved.plan?.version === this.#current.version) await this.submitPlan(saved.plan); }
    catch { /* Missing or obsolete state returns to onboarding. */ }
  }
  async persist() {
    if (!this.stateFile) return;
    await mkdir(dirname(this.stateFile), { recursive: true });
    const temporary = `${this.stateFile}.tmp`;
    await writeFile(temporary, JSON.stringify({ path: this.#current?.repo.path || null, plan: this.#plan }), { mode: 0o600 });
    await rename(temporary, this.stateFile);
  }
  connect(path) {
    return this.run(async () => {
      const snapshot = await readRepository(path);
      if (this.#current?.repo.path === snapshot.repo.path && this.#current.version === snapshot.version) return this.#current;
      if (this.#current?.repo.path === snapshot.repo.path && this.#plan) snapshot.planStatus = 'stale';
      this.#current = snapshot; this.#plan = null; this.revision++; await this.persist(); return snapshot;
    });
  }
  disconnect() { return this.run(async () => { this.#current = null; this.#plan = null; this.revision++; await this.persist(); }); }
  async updateFromGit() {
    if (!this.#current) throw new Error('Open a repository in Ordiff first.');
    const snapshot = await readRepository(this.#current.repo.path);
    if (snapshot.version !== this.#current.version) { snapshot.planStatus = this.#plan || this.#current.planStatus === 'stale' ? 'stale' : 'none'; this.#current = snapshot; this.#plan = null; this.revision++; await this.persist(); }
    return this.#current;
  }
  refresh() { return this.run(() => this.updateFromGit()); }
  submitPlan(plan) {
    return this.run(async () => {
      const snapshot = await this.updateFromGit();
      if (plan.version !== snapshot.version) throw new Error('The diff changed. Read the current context and submit a plan for the new version.');
      if (!Array.isArray(plan.groups) || !plan.groups.length || plan.groups.length > 100) throw new Error('A review plan needs between 1 and 100 behavior groups.');
      const validIds = new Set(snapshot.sections.map(section => section.id));
      const groupIds = new Set();
      const groups = plan.groups.map(group => {
        if (typeof group.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(group.id) || groupIds.has(group.id)) throw new Error('Behavior identifiers must be unique simple names.');
        if (typeof group.title !== 'string' || !group.title.trim() || group.title.length > 160 || typeof group.description !== 'string' || group.description.length > 1000) throw new Error('Each behavior needs a short title and description.');
        if (!Array.isArray(group.steps) || !group.steps.length || group.steps.length > 500) throw new Error('Each behavior needs at least one step.');
        groupIds.add(group.id);
        const seen = new Set();
        const explanations = {};
        for (const step of group.steps) {
          if (!validIds.has(step.sectionId)) throw new Error(`Unknown diff section: ${step.sectionId}`);
          if (seen.has(step.sectionId)) throw new Error('A behavior cannot repeat the same section.');
          if (typeof step.explanation !== 'string' || step.explanation.length > 2000) throw new Error('Step explanations must be short text.');
          seen.add(step.sectionId); explanations[step.sectionId] = step.explanation;
        }
        return { id: group.id, title: group.title, short: group.title, description: group.description, sections: [...seen], explanations };
      });
      this.#plan = plan;
      this.#current = { ...snapshot, groups, planStatus: 'current', sections: snapshot.sections.map(section => ({ ...section, group: groups.find(group => group.sections.includes(section.id))?.id || null })) };
      this.revision++; await this.persist(); return this.#current;
    });
  }
}
