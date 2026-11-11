import type { DiffSection, PreviewKind } from "../types";

export const MAX_PREVIEW_BYTES = 25 * 1024 * 1024;
export function previewKind(section: DiffSection): PreviewKind {
  if (section.file) return section.file.kind;
  if (/\.(md|markdown)$/i.test(section.path)) return "markdown";
  if (/\.csv$/i.test(section.path)) return "csv";
  return "unsupported";
}
export function fileUrl(
  sectionId: string,
  version: string,
  side: "before" | "after",
  format?: string,
  resource?: string,
) {
  const query = new URLSearchParams({ sectionId, version, side });
  if (format) query.set("format", format);
  if (resource) query.set("resource", resource);
  return `/api/file?${query}`;
}
export function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
}
export async function fetchFile(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    let message = "This file could not be opened.";
    try {
      message = (await response.json()).error || message;
    } catch {
      /* Use a readable fallback. */
    }
    throw new Error(message);
  }
  return {
    buffer: await response.arrayBuffer(),
    mimeType:
      response.headers.get("content-type") || "application/octet-stream",
  };
}
