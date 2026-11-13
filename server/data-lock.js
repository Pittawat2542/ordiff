import { mkdir, open, readFile, rm } from "node:fs/promises";
import { readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
export async function acquireDataLock(stateFile) {
  if (!stateFile) return async () => {};
  const directory = dirname(stateFile),
    file = join(directory, "backend.lock"),
    token = randomUUID();
  await mkdir(directory, { recursive: true });
  async function acquire() {
    const handle = await open(file, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid, token }));
    } finally {
      await handle.close();
    }
  }
  try {
    await acquire();
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let existing;
    try {
      existing = JSON.parse(await readFile(file, "utf8"));
    } catch {
      throw Object.assign(
        new Error(
          "Review data is locked by another backend. Close it before reopening Ordiff.",
        ),
        { code: "DATA_LOCKED" },
      );
    }
    let alive = true;
    try {
      process.kill(existing.pid, 0);
    } catch (e) {
      alive = e.code !== "ESRCH";
    }
    if (alive)
      throw Object.assign(
        new Error("Another Ordiff backend owns this data directory."),
        { code: "DATA_LOCKED" },
      );
    await rm(file, { force: true });
    await acquire();
  }
  const cleanup = () => {
    try {
      if (JSON.parse(readFileSync(file, "utf8")).token === token)
        unlinkSync(file);
    } catch {
      /* already released */
    }
  };
  process.once("exit", cleanup);
  return async () => {
    process.off("exit", cleanup);
    cleanup();
  };
}
