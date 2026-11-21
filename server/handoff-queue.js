// The MCP adapters and backend share only this inbox. SQLite transactions reserve
// capacity and publish receipts atomically, even across independent agent processes.
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export function planReceipt(snapshotId, groups) {
  return createHash("sha256")
    .update(JSON.stringify([snapshotId, groups]))
    .digest("hex");
}

export class HandoffQueue {
  constructor(root, maxBytes = 512 * 1024 * 1024) {
    this.directory = join(root, "handoffs");
    this.file = join(this.directory, "inbox.sqlite");
    this.maxBytes = maxBytes;
  }
  transaction(operation) {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(this.file);
    try {
      db.exec(`
        PRAGMA busy_timeout = 5000;
        PRAGMA foreign_keys = ON;
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS captures (
          version TEXT PRIMARY KEY, path TEXT NOT NULL, payload BLOB NOT NULL, expires INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS plans (
          receipt TEXT PRIMARY KEY, version TEXT NOT NULL REFERENCES captures(version), groupsJson BLOB NOT NULL
        );
        DELETE FROM captures WHERE expires < unixepoch() AND version NOT IN (SELECT version FROM plans);
      `);
      const result = operation(db);
      db.exec("COMMIT");
      return result;
    } finally {
      db.close();
    }
  }
  checkCapacity(db) {
    const { bytes } = db
      .prepare(
        `SELECT
      (SELECT coalesce(sum(length(payload)), 0) FROM captures) +
      (SELECT coalesce(sum(length(groupsJson)), 0) FROM plans) AS bytes`,
      )
      .get();
    if (bytes > this.maxBytes)
      throw new Error(
        "The Ordiff handoff queue is full. Open Ordiff to import pending work, then retry.",
      );
  }
  capture(snapshot) {
    this.transaction((db) => {
      const renewed = db
        .prepare(
          "UPDATE captures SET expires = unixepoch() + 1800 WHERE version = ?",
        )
        .run(snapshot.version);
      if (renewed.changes) return;
      db.prepare(
        "INSERT INTO captures VALUES (?, ?, ?, unixepoch() + 1800)",
      ).run(
        snapshot.version,
        snapshot.repo.path,
        Buffer.from(JSON.stringify(snapshot)),
      );
      this.checkCapacity(db);
    });
  }
  pathFor(version) {
    if (!version || !existsSync(this.file)) return null;
    return this.transaction(
      (db) =>
        db.prepare("SELECT path FROM captures WHERE version = ?").get(version)
          ?.path,
    );
  }
  read(version, path) {
    if (!existsSync(this.file)) return null;
    return this.transaction((db) => {
      const row = db
        .prepare(
          "SELECT CAST(payload AS TEXT) AS payload FROM captures WHERE version = ?",
        )
        .get(version);
      if (!row) return null;
      const snapshot = JSON.parse(row.payload);
      if (path && snapshot.repo.path !== path)
        throw new Error("Snapshot belongs to another checkout.");
      db.prepare(
        "UPDATE captures SET expires = unixepoch() + 1800 WHERE version = ?",
      ).run(version);
      return snapshot;
    });
  }
  enqueue(path, { snapshotId, groups }) {
    const receipt = planReceipt(snapshotId, groups);
    return this.transaction((db) => {
      const row = db
        .prepare("SELECT path FROM captures WHERE version = ?")
        .get(snapshotId);
      if (!row || row.path !== path)
        throw new Error("Read the review context for this checkout again.");
      db.prepare("INSERT OR IGNORE INTO plans VALUES (?, ?, ?)").run(
        receipt,
        snapshotId,
        Buffer.from(JSON.stringify(groups)),
      );
      this.checkCapacity(db);
      return receipt;
    });
  }
  pending() {
    if (!existsSync(this.file)) return [];
    return this.transaction((db) =>
      db
        .prepare(
          `SELECT receipt, path FROM plans JOIN captures USING(version)
      ORDER BY plans.rowid`,
        )
        .all(),
    );
  }
  get(receipt) {
    return this.transaction((db) => {
      const row = db
        .prepare(
          `SELECT CAST(payload AS TEXT) AS payload, CAST(groupsJson AS TEXT) AS groupsJson
        FROM plans JOIN captures USING(version) WHERE receipt = ?`,
        )
        .get(receipt);
      return (
        row && {
          snapshot: JSON.parse(row.payload),
          groups: JSON.parse(row.groupsJson),
        }
      );
    });
  }
  acknowledge(receipt) {
    this.transaction((db) =>
      db.prepare("DELETE FROM plans WHERE receipt = ?").run(receipt),
    );
  }
}
