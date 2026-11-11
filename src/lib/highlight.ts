import { common, createLowlight } from "lowlight";
import type { DiffSection } from "../types";

const lowlight = createLowlight(common);
const extensions: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cs: "csharp",
  swift: "swift",
  php: "php",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  json: "json",
  jsonc: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  ini: "ini",
  css: "css",
  scss: "scss",
  html: "xml",
  htm: "xml",
  xml: "xml",
  svg: "xml",
  vue: "xml",
  svelte: "xml",
  sql: "sql",
  md: "markdown",
  markdown: "markdown",
  diff: "diff",
  dockerfile: "dockerfile",
  makefile: "makefile",
  graphql: "graphql",
};
export interface HighlightToken {
  text: string;
  className?: string;
}
type HighlightNode = {
  type: string;
  value?: string;
  properties?: { className?: unknown };
  children?: HighlightNode[];
};

export function languageFor(section: Pick<DiffSection, "path" | "language">) {
  const filename = section.path.split("/").at(-1)!.toLowerCase();
  const extension = filename.includes(".")
    ? filename.split(".").at(-1)!
    : filename;
  const fromPath = extensions[extension];
  if (fromPath && lowlight.registered(fromPath)) return fromPath;
  const language = section.language?.toLowerCase() || "";
  const mapped = extensions[language] || language;
  return lowlight.registered(mapped) ? mapped : null;
}
export function highlightLines(
  source: string,
  language: string | null,
): HighlightToken[][] {
  if (!language || source.length > 200000)
    return source.split("\n").map((text) => [{ text }]);
  let tree: HighlightNode;
  try {
    tree = lowlight.highlight(language, source);
  } catch {
    return source.split("\n").map((text) => [{ text }]);
  }
  const lines: HighlightToken[][] = [[]];
  function walk(node: HighlightNode, scopes: string[]) {
    if (node.type === "text") {
      const parts = (node.value || "").split("\n");
      parts.forEach((text, index) => {
        if (index) lines.push([]);
        if (text)
          lines.at(-1)!.push({
            text,
            className: scopes.length
              ? [...new Set(scopes)].join(" ")
              : undefined,
          });
      });
      return;
    }
    const classes = Array.isArray(node.properties?.className)
      ? node.properties.className.map((name) =>
          String(name)
            .replace(/^hljs-/, "token-")
            .replace(/^(\w+)_$/, "token-$1"),
        )
      : [];
    node.children?.forEach((child) => walk(child, [...scopes, ...classes]));
  }
  walk(tree, []);
  return lines;
}
export function highlightDiff(section: DiffSection) {
  const lines = section.lines || [];
  const language = languageFor(section);
  const before = highlightLines(
    lines
      .filter((line) => line.type !== "add")
      .map((line) => line.text)
      .join("\n"),
    language,
  );
  const after = highlightLines(
    lines
      .filter((line) => line.type !== "remove")
      .map((line) => line.text)
      .join("\n"),
    language,
  );
  let oldIndex = 0,
    newIndex = 0;
  return lines.map((line) => {
    if (line.type === "remove") return before[oldIndex++];
    if (line.type === "add") return after[newIndex++];
    oldIndex++;
    return after[newIndex++];
  });
}
