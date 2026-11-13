import { runFile } from "./processes.js";
import {
  realpath,
  lstat,
  readFile,
  readlink,
  open,
  mkdtemp,
  writeFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createHash } from "node:crypto";
import {
  describeFile,
  fileFormat,
  originalRevision,
  workingFile,
} from "./files.js";
import { expandHomePath } from "./directories.js";

const exec = runFile;
export const hash = (value) =>
  createHash("sha256").update(value).digest("hex").slice(0, 24);
async function git(path, args) {
  return (
    await exec(
      "git",
      ["--no-pager", "-c", "core.quotePath=false", "-C", path, ...args],
      {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        timeout: 15000,
        env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      },
    )
  ).stdout;
}

function category(path) {
  if (/(^|\/)(test[s]?|__tests__)(\/|$)|\.(test|spec)\./i.test(path))
    return ["Tests", /tsx|jsx/.test(path) ? "TSX" : "TypeScript"];
  if (/\.(md|mdx|rst|txt)$/i.test(path)) return ["Docs", "Markdown"];
  if (/(^|\/)server\//.test(path)) return ["Backend", "JavaScript"];
  if (/(^|\/)pipeline\//.test(path)) return ["Pipeline", "JavaScript"];
  if (/\.(jsx|tsx|html|css)$|src\/main\./.test(path))
    return [
      "UI",
      /tsx|jsx/.test(path)
        ? "TSX"
        : path.endsWith(".css")
          ? "CSS"
          : "JavaScript",
    ];
  if (/\.(json|ya?ml|toml)$|(^|\/)\./.test(path))
    return ["Config", "Configuration"];
  return ["Code", "Code"];
}
function section(path, header, lines, extra = {}) {
  const [role, language] = category(path);
  return {
    id: `hunk-${hash(JSON.stringify([path, header, lines]))}`,
    path,
    role,
    language,
    group: null,
    symbol: header,
    title: header.startsWith("@@")
      ? header.replace(/^@@.*?@@\s*/, "") || "Changed section"
      : header,
    explanation: "",
    checklist: [],
    lines,
    ...extra,
  };
}
function parsePatch(path, patch) {
  const result = [];
  let current, oldLine, newLine;
  for (const row of patch.split("\n")) {
    const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(row);
    if (match) {
      oldLine = Number(match[1]);
      newLine = Number(match[2]);
      current = { header: row, lines: [] };
      result.push(current);
    } else if (current && [" ", "-", "+"].includes(row[0])) {
      const type =
        row[0] === "+" ? "add" : row[0] === "-" ? "remove" : "context";
      current.lines.push({
        type,
        text: row.slice(1),
        old: type === "add" ? null : oldLine++,
        new: type === "remove" ? null : newLine++,
        extra: false,
      });
    }
  }
  if (result.length)
    return result.map((item) => section(path, item.header, item.lines));
  if (patch.trim()) {
    const binary = /Binary files|GIT binary patch/.test(patch);
    const detail = binary
      ? "Binary file changed."
      : patch
          .split("\n")
          .filter((row) => /mode |rename |similarity /.test(row))
          .join("\n") || "File metadata changed.";
    return [
      section(
        path,
        binary ? "Binary file changed" : "File metadata changed",
        [{ type: "context", text: detail, old: null, new: null }],
        { binary },
      ),
    ];
  }
  return [];
}
async function addedFile(root, path) {
  const filename = join(root, path);
  const stat = await lstat(filename);
  if (stat.isSymbolicLink())
    return [
      section(path, "New symbolic link", [
        { type: "add", text: await readlink(filename), old: null, new: 1 },
      ]),
    ];
  if (!stat.isFile()) return [];
  const handle = await open(filename, "r");
  let binary;
  try {
    const sample = Buffer.alloc(8192);
    const { bytesRead } = await handle.read(sample, 0, sample.length, 0);
    binary = sample.subarray(0, bytesRead).includes(0);
  } finally {
    await handle.close();
  }
  if (binary || stat.size > 2 * 1024 * 1024)
    return [
      section(
        path,
        binary ? "New binary file" : "Large file",
        [
          {
            type: "context",
            text: `${binary ? "Binary file" : "Text preview omitted: larger than 2 MiB"} (${stat.size.toLocaleString()} bytes).`,
            old: null,
            new: null,
          },
        ],
        { binary: true },
      ),
    ];
  const rows = (await readFile(filename, "utf8")).split("\n");
  if (rows.at(-1) === "") rows.pop();
  const lines = rows.map((text, index) => ({
    type: "add",
    text,
    old: null,
    new: index + 1,
    extra: false,
  }));
  return [
    section(
      path,
      `New file · ${lines.length} ${lines.length === 1 ? "line" : "lines"}`,
      lines.length
        ? lines
        : [
            {
              type: "context",
              text: "Empty file added.",
              old: null,
              new: null,
            },
          ],
    ),
  ];
}
async function readRepositoryOnce(
  input,
  comparison = { kind: "working-tree" },
) {
  const { comparisonSchema } = await import("../shared/contracts.js");
  comparison = comparisonSchema.parse(comparison);
  if (typeof input !== "string" || !input.trim())
    throw new Error("Enter a local Git repository directory.");
  let root;
  try {
    const directory = await realpath(expandHomePath(input));
    root = (await git(directory, ["rev-parse", "--show-toplevel"])).trim();
  } catch {
    throw new Error(
      "This directory is not an accessible Git repository. Check the path and try again.",
    );
  }
  let head = "";
  try {
    head = (await git(root, ["rev-parse", "--verify", "HEAD"])).trim();
  } catch {
    /* New repositories have no HEAD. */
  }
  const branch =
    (
      await git(root, ["symbolic-ref", "--short", "-q", "HEAD"]).catch(() => "")
    ).trim() || (head ? `Detached ${head.slice(0, 7)}` : "New branch");
  let before = head,
    after = null;
  if (comparison.kind !== "working-tree") {
    const resolveRef = async (ref) => {
      try {
        return (
          await git(root, [
            "rev-parse",
            "--verify",
            "--end-of-options",
            `${ref}^{commit}`,
          ])
        ).trim();
      } catch {
        throw Object.assign(
          new Error("Choose a valid local commit or branch."),
          { status: 422 },
        );
      }
    };
    before = await resolveRef(
      comparison.kind === "branch" ? comparison.baseRef : comparison.beforeRef,
    );
    after = await resolveRef(
      comparison.kind === "branch" ? comparison.headRef : comparison.afterRef,
    );
    if (comparison.kind === "branch") {
      const bases = (
        await git(root, ["merge-base", "--all", before, after]).catch(() => "")
      )
        .trim()
        .split("\n")
        .filter(Boolean);
      if (bases.length !== 1)
        throw Object.assign(
          new Error(
            bases.length
              ? "Multiple merge bases. Choose exact commits."
              : "No merge base found.",
          ),
          { status: 422 },
        );
      before = bases[0];
    }
  }
  const inventory = !after
    ? await git(root, [
        "status",
        "--porcelain=v2",
        "-z",
        "--untracked-files=all",
      ])
    : "";
  const untracked = after
    ? []
    : (await git(root, ["ls-files", "--others", "--exclude-standard", "-z"]))
        .split("\0")
        .filter(Boolean);
  const tracked = (
    await git(
      root,
      after
        ? ["diff", "--name-only", "--no-renames", "-z", before, after, "--"]
        : head
          ? ["diff", "--name-only", "--no-renames", "-z", "HEAD", "--"]
          : ["ls-files", "-z"],
    )
  )
    .split("\0")
    .filter(Boolean);
  const paths = [...new Set([...tracked, ...untracked])].sort();
  if (paths.length > 500)
    throw new Error(
      "This working tree has more than 500 changed files. Narrow the changes before opening it in Ordiff.",
    );
  const sections = [];
  for (const path of paths) {
    if ((!head && !after) || untracked.includes(path)) {
      try {
        sections.push(...(await addedFile(root, path)));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    } else
      sections.push(
        ...parsePatch(
          path,
          await git(root, [
            "diff",
            "--no-color",
            "--no-ext-diff",
            "--no-textconv",
            "--no-renames",
            "--unified=3",
            before,
            ...(after ? [after] : []),
            "--",
            `:(literal)${path}`,
          ]),
        ),
      );
  }
  const previews = new Map();
  for (const item of sections) {
    if (!item.binary && fileFormat(item.path).kind === "unsupported") continue;
    if (!previews.has(item.path))
      previews.set(
        item.path,
        await describeFile(root, item.path, before, after),
      );
    const file = previews.get(item.path);
    if (file) {
      item.file = file;
      if (item.binary)
        item.id = `hunk-${hash(JSON.stringify([item.id, file.before?.hash, file.after?.hash]))}`;
    }
  }
  const files = [];
  let capturedBytes = 0;
  for (const path of paths) {
    const original = await originalRevision(root, path, before);
    let working = null;
    if (after) working = await originalRevision(root, path, after);
    else {
      try {
        working = (await workingFile(root, path)).revision;
      } catch (error) {
        if (![403, 404].includes(error.status)) throw error;
      }
    }
    const file = {
      id: `file-${hash(path)}`,
      path,
      before: original,
      after: working,
      beforeText: null,
      afterText: null,
    };
    for (const side of ["before", "after"]) {
      const revision = file[side];
      if (
        !revision ||
        revision.size > 2 * 1024 * 1024 ||
        capturedBytes + revision.size > 64 * 1024 * 1024
      )
        continue;
      let bytes;
      if (side === "before" || after)
        bytes = (
          await exec("git", ["-C", root, "cat-file", "blob", revision.hash], {
            encoding: "buffer",
            maxBuffer: 3 * 1024 * 1024,
            env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
          })
        ).stdout;
      else {
        const current = await workingFile(root, path);
        if (current.revision.hash !== revision.hash)
          throw Object.assign(
            new Error("Files are still changing. Refresh again."),
            { status: 409 },
          );
        bytes = current.bytes;
      }
      if (bytes && !bytes.includes(0)) {
        file[`${side}Text`] = bytes.toString("utf8");
        capturedBytes += bytes.length;
      }
    }
    files.push(file);
    for (const section of sections.filter((s) => s.path === path))
      section.fileId = file.id;
  }
  // Build text hunks from exactly the bytes used by context and line anchors.
  const temporary = await mkdtemp(join(tmpdir(), "ordiff-snapshot-"));
  try {
    for (const file of files) {
      const relevant = sections.filter((s) => s.path === file.path);
      if (
        relevant.some((s) => s.binary) ||
        (!file.beforeText && !file.afterText)
      )
        continue;
      if (
        (file.before && file.beforeText === null) ||
        (file.after && file.afterText === null)
      )
        continue;
      const beforeFile = join(temporary, `before-${basename(file.path)}`),
        afterFile = join(temporary, `after-${basename(file.path)}`);
      await writeFile(beforeFile, file.beforeText || "");
      await writeFile(afterFile, file.afterText || "");
      let patch;
      try {
        patch = (
          await exec(
            "git",
            [
              "--no-pager",
              "diff",
              "--no-index",
              "--no-color",
              "--no-ext-diff",
              "--no-textconv",
              "--unified=3",
              "--",
              beforeFile,
              afterFile,
            ],
            {
              encoding: "utf8",
              maxBuffer: 16 * 1024 * 1024,
              timeout: 15000,
              env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
            },
          )
        ).stdout;
      } catch (error) {
        if (error.code !== 1) throw error;
        patch = error.stdout;
      }
      if (!patch.trim()) continue;
      const replacements = parsePatch(file.path, patch).map((s) => ({
        ...s,
        fileId: file.id,
        ...(relevant[0]?.file ? { file: relevant[0].file } : {}),
      }));
      const start = sections.findIndex((s) => s.path === file.path);
      if (start >= 0) sections.splice(start, relevant.length, ...replacements);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  if (!after) {
    const endInventory = await git(root, [
      "status",
      "--porcelain=v2",
      "-z",
      "--untracked-files=all",
    ]);
    const endHead = (
      await git(root, ["rev-parse", "--verify", "HEAD"]).catch(() => "")
    ).trim();
    if (inventory !== endInventory || head !== endHead)
      throw Object.assign(
        new Error("Files are still changing. Refresh again."),
        { status: 409, code: "SNAPSHOT_MOVED" },
      );
    for (const file of files) {
      if (!file.after) continue;
      let current;
      try {
        current = await workingFile(root, file.path);
      } catch (error) {
        if ([403, 404].includes(error.status))
          throw Object.assign(
            new Error("Files are still changing. Refresh again."),
            { status: 409, code: "SNAPSHOT_MOVED" },
          );
        throw error;
      }
      if (current.revision.hash !== file.after.hash)
        throw Object.assign(
          new Error("Files are still changing. Refresh again."),
          { status: 409, code: "SNAPSHOT_MOVED" },
        );
    }
  }
  const version = hash(
    JSON.stringify([
      root,
      comparison,
      before,
      after,
      sections.map((item) => [item.id, item.file]),
      files.map((f) => [f.path, f.before, f.after]),
    ]),
  );
  return {
    version,
    snapshotId: version,
    comparison,
    resolved: { before, after },
    capturedAt: new Date().toISOString(),
    files,
    repo: {
      path: root,
      name: basename(root),
      branch,
      hasHead: Boolean(head),
      source: "git",
    },
    sections,
    groups: [],
    planStatus: "none",
  };
}

export async function listRefs(root) {
  const rows = await git(root, [
    "for-each-ref",
    "--format=%(refname:short)%09%(objectname)%09%(subject)",
    "refs/heads",
    "refs/remotes",
    "refs/tags",
  ]);
  return rows
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((row) => {
      const [name, oid, ...subject] = row.split("\t");
      return { name, oid, subject: subject.join("\t") };
    });
}
export async function listCommits(root, ref = "HEAD", offset = 0, limit = 100) {
  const oid = (
    await git(root, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${ref}^{commit}`,
    ])
  ).trim();
  return (
    await git(root, [
      "log",
      `--skip=${offset}`,
      `--max-count=${limit}`,
      "--format=%H%x09%s",
      oid,
      "--",
    ])
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((row) => {
      const [oid, ...subject] = row.split("\t");
      return { oid, subject: subject.join("\t") };
    });
}

export async function readRepository(
  input,
  comparison = { kind: "working-tree" },
) {
  try {
    return await readRepositoryOnce(input, comparison);
  } catch (error) {
    if (error.code !== "SNAPSHOT_MOVED") throw error;
    return readRepositoryOnce(input, comparison);
  }
}
export async function sourceSignature(snapshot) {
  const root = snapshot.repo.path,
    spec = snapshot.comparison;
  if (
    spec?.kind === "commits" &&
    /^[a-f0-9]{40,64}$/.test(spec.beforeRef) &&
    /^[a-f0-9]{40,64}$/.test(spec.afterRef)
  )
    return snapshot.version;
  if (spec && spec.kind !== "working-tree") {
    const refs =
      spec.kind === "branch"
        ? [spec.baseRef, spec.headRef]
        : [spec.beforeRef, spec.afterRef];
    return hash(
      await Promise.all(
        refs.map((ref) =>
          git(root, [
            "rev-parse",
            "--verify",
            "--end-of-options",
            `${ref}^{commit}`,
          ]),
        ),
      ),
    );
  }
  const status = await git(root, [
    "status",
    "--porcelain=v2",
    "-z",
    "--untracked-files=all",
  ]);
  const head = await git(root, ["rev-parse", "--verify", "HEAD"]).catch(
    () => "",
  );
  const stats = [];
  for (const file of snapshot.files || []) {
    try {
      const stat = await lstat(join(root, file.path));
      stats.push([file.path, stat.size, stat.mtimeMs, stat.ctimeMs]);
    } catch {
      stats.push([file.path, "missing"]);
    }
  }
  return hash([status, head, stats]);
}
