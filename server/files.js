import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import {
  resolve,
  relative,
  isAbsolute,
  extname,
  basename,
  dirname,
} from "node:path";
import { runFile } from "./processes.js";
import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const exec = runFile;
const digest = (value) =>
  createHash("sha256").update(value).digest("hex").slice(0, 24);
export class FileError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const formats = {
  png: ["image", "image/png"],
  jpg: ["image", "image/jpeg"],
  jpeg: ["image", "image/jpeg"],
  gif: ["image", "image/gif"],
  webp: ["image", "image/webp"],
  avif: ["image", "image/avif"],
  svg: ["image", "image/svg+xml"],
  ico: ["image", "image/x-icon"],
  bmp: ["image", "image/bmp"],
  tif: ["image", "image/tiff"],
  tiff: ["image", "image/tiff"],
  pdf: ["pdf", "application/pdf"],
  docx: [
    "word",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  doc: ["word-doc", "application/msword"],
  xlsx: [
    "spreadsheet",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
  csv: ["csv", "text/csv"],
  md: ["markdown", "text/markdown"],
  markdown: ["markdown", "text/markdown"],
  mp3: ["audio", "audio/mpeg"],
  wav: ["audio", "audio/wav"],
  ogg: ["audio", "audio/ogg"],
  flac: ["audio", "audio/flac"],
  m4a: ["audio", "audio/mp4"],
  mp4: ["video", "video/mp4"],
  webm: ["video", "video/webm"],
  mov: ["video", "video/quicktime"],
};
export function fileFormat(path) {
  const [kind, mimeType] = formats[extname(path).slice(1).toLowerCase()] || [
    "unsupported",
    "application/octet-stream",
  ];
  return { kind, mimeType };
}
async function git(root, args, encoding = "utf8") {
  return (
    await exec("git", ["--no-pager", "-C", root, ...args], {
      encoding,
      maxBuffer: MAX_FILE_BYTES + 1024,
      timeout: 15000,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    })
  ).stdout;
}
async function checkedPath(root, path) {
  const filename = resolve(root, path);
  const within = relative(root, filename);
  if (
    !within ||
    isAbsolute(path) ||
    within.startsWith("../") ||
    isAbsolute(within)
  )
    throw new FileError(403, "This file is outside the selected repository.");
  let current = root;
  for (const part of within.split("/")) {
    current = resolve(current, part);
    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      if (error.code === "ENOENT")
        throw new FileError(
          404,
          "This file is no longer in the working tree. Refresh the diff.",
        );
      throw error;
    }
    if (stat.isSymbolicLink())
      throw new FileError(
        403,
        "Symbolic link targets are not available for preview.",
      );
  }
  return filename;
}
export async function workingFile(root, path) {
  const filename = await checkedPath(root, path);
  let handle;
  try {
    handle = await open(
      filename,
      constants.O_RDONLY | (constants.O_NOFOLLOW || 0),
    );
  } catch (error) {
    if (error.code === "ELOOP")
      throw new FileError(
        403,
        "Symbolic link targets are not available for preview.",
      );
    throw error;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile())
      throw new FileError(404, "This change is not a regular file.");
    const bytes = stat.size <= MAX_FILE_BYTES ? await handle.readFile() : null;
    const after = await handle.stat();
    const current = await lstat(await checkedPath(root, path));
    if (
      stat.ino !== current.ino ||
      stat.dev !== current.dev ||
      stat.size !== after.size ||
      stat.mtimeMs !== after.mtimeMs
    )
      throw new FileError(
        409,
        "This file changed. Refresh the diff before previewing it.",
      );
    return {
      bytes,
      revision: {
        size: stat.size,
        hash: digest(bytes || `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`),
      },
    };
  } finally {
    await handle.close();
  }
}
export async function originalRevision(root, path, head) {
  if (!head) return null;
  const row = await git(root, [
    "ls-tree",
    "-l",
    "-z",
    head,
    "--",
    `:(literal)${path}`,
  ]);
  const match = /^(100644|100755) blob ([a-f0-9]+)\s+(\d+)\t/.exec(row);
  return match ? { size: Number(match[3]), hash: match[2] } : null;
}
export async function describeFile(root, path, head, afterCommit = null) {
  let after = null;
  try {
    after = afterCommit
      ? await originalRevision(root, path, afterCommit)
      : (await workingFile(root, path)).revision;
  } catch (error) {
    if (![403, 404].includes(error.status)) throw error;
  }
  const before = await originalRevision(root, path, head);
  return before || after
    ? { ...fileFormat(path), base: head || null, afterCommit, before, after }
    : null;
}
export async function readPreviewFile(snapshot, sectionId, version, side) {
  if (!snapshot || snapshot.version !== version)
    throw new FileError(
      409,
      "The diff changed. Refresh it before opening this preview.",
    );
  const section = snapshot.sections.find((item) => item.id === sectionId);
  if (!section?.file)
    throw new FileError(404, "This changed file is not available for preview.");
  if (!["before", "after"].includes(side))
    throw new FileError(400, "Choose the original file or working tree.");
  const revision = section.file[side];
  if (!revision)
    throw new FileError(
      404,
      side === "before"
        ? "This is a new file with no original version."
        : "This file was deleted from the working tree.",
    );
  if (revision.size > MAX_FILE_BYTES)
    throw new FileError(
      413,
      "File previews are limited to 25 MiB. Open this file in your editor.",
    );
  let bytes;
  const captured = snapshot.files?.find((file) => file.id === section.fileId)?.[
    `${side}Text`
  ];
  if (typeof captured === "string") bytes = Buffer.from(captured);
  else if (side === "before" || section.file.afterCommit)
    bytes = await git(
      snapshot.repo.path,
      ["cat-file", "blob", revision.hash],
      "buffer",
    );
  else {
    const current = await workingFile(snapshot.repo.path, section.path);
    if (!current.bytes || current.revision.hash !== revision.hash)
      throw new FileError(
        409,
        "This file changed. Refresh the diff before previewing it.",
      );
    bytes = current.bytes;
  }
  return { bytes, name: basename(section.path), ...section.file };
}
export async function readMarkdownImage(
  snapshot,
  sectionId,
  version,
  side,
  resource,
) {
  const source = await readPreviewFile(snapshot, sectionId, version, side);
  if (source.kind !== "markdown")
    throw new FileError(
      403,
      "Only Markdown images can be opened through this reference.",
    );
  const section = snapshot.sections.find((item) => item.id === sectionId);
  const local = (value) => {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) return null;
    try {
      return decodeURIComponent(value.split(/[?#]/)[0]);
    } catch {
      return null;
    }
  };
  const { fromMarkdown } = await import("mdast-util-from-markdown");
  const tree = fromMarkdown(source.bytes.toString("utf8"));
  const definitions = new Map(),
    references = new Set();
  function walk(node, visit) {
    visit(node);
    node.children?.forEach((child) => walk(child, visit));
  }
  walk(tree, (node) => {
    if (node.type === "definition") definitions.set(node.identifier, node.url);
  });
  walk(tree, (node) => {
    const url =
      node.type === "image"
        ? node.url
        : node.type === "imageReference"
          ? definitions.get(node.identifier)
          : null;
    if (url && local(url)) references.add(local(url));
  });
  const requested = local(resource);
  if (!requested || !references.has(requested))
    throw new FileError(
      403,
      "This image is not referenced by the Markdown document.",
    );
  const path = relative(
    snapshot.repo.path,
    resolve(
      snapshot.repo.path,
      requested.startsWith("/")
        ? requested.slice(1)
        : `${dirname(section.path)}/${requested}`,
    ),
  );
  if (!path || path.startsWith("../") || isAbsolute(path))
    throw new FileError(403, "This image is outside the selected repository.");
  const format = fileFormat(path);
  if (format.kind !== "image")
    throw new FileError(403, "Only image references can be previewed.");
  if (side === "after") {
    const changed = snapshot.sections.find(
      (item) => item.path === path && item.file,
    );
    if (changed) return readPreviewFile(snapshot, changed.id, version, side);
  }
  const original = await originalRevision(
    snapshot.repo.path,
    path,
    side === "after" && source.afterCommit ? source.afterCommit : source.base,
  );
  if (!original)
    throw new FileError(
      404,
      "This image is not part of the repository snapshot. Refresh the diff.",
    );
  if (original.size > MAX_FILE_BYTES)
    throw new FileError(413, "This image is too large to preview.");
  let bytes;
  if (side === "before" || source.afterCommit)
    bytes = await git(
      snapshot.repo.path,
      ["cat-file", "blob", original.hash],
      "buffer",
    );
  else {
    const current = await workingFile(snapshot.repo.path, path);
    bytes = current.bytes;
    if (!bytes) throw new FileError(413, "This image is too large to preview.");
    const objectId = createHash(original.hash.length === 64 ? "sha256" : "sha1")
      .update(`blob ${bytes.length}\0`)
      .update(bytes)
      .digest("hex");
    if (objectId !== original.hash)
      throw new FileError(409, "This image changed. Refresh the diff.");
  }
  return { bytes, name: basename(path), ...format };
}
export function extractWordText(bytes) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./word-worker.js", import.meta.url), {
      workerData: bytes,
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    });
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(new FileError(422, "This Word document took too long to open."));
    }, 15000);
    const finish = (callback) => (value) => {
      clearTimeout(timer);
      void worker.terminate();
      callback(value);
    };
    worker.once(
      "message",
      finish((result) =>
        result.error
          ? reject(new FileError(422, "This Word document could not be read."))
          : resolve(result.text),
      ),
    );
    worker.once(
      "error",
      finish(() =>
        reject(new FileError(422, "This Word document could not be read.")),
      ),
    );
    worker.once("exit", (code) => {
      if (code !== 0) {
        clearTimeout(timer);
        reject(new FileError(422, "This Word document could not be read."));
      }
    });
  });
}
