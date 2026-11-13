import { useEffect, useMemo, useRef, useState } from "react";
import type {
  DiffLine,
  DiffSection,
  FeedbackAnchor,
  FeedbackComment,
} from "../types";
import { highlightDiff } from "../lib/highlight";
import { Button } from "./ui/button";
import { NativeDialog } from "./dialogs";
type Selection = { side: "before" | "after"; start: number; end: number };
type TextPage = {
  lines: { number: number; text: string }[];
  totalLines: number;
};
type Display = {
  split: boolean;
  wrap: boolean;
  words: boolean;
  whitespace: boolean;
};
export function DiffText({
  section,
  version,
  onAddComment,
  query = "",
  expanded = false,
  comments = [],
  revealAnchor,
}: {
  section: DiffSection;
  version?: string;
  onAddComment?: (scope: "file" | "section", anchor?: FeedbackAnchor) => void;
  query?: string;
  expanded?: boolean;
  comments?: FeedbackComment[];
  revealAnchor?: FeedbackAnchor | null;
}) {
  const [display, setDisplay] = useState<Display>(() => {
    try {
      return {
        ...{ split: false, wrap: true, words: true, whitespace: false },
        ...JSON.parse(localStorage.getItem("ordiff.diff-display") || "{}"),
      };
    } catch {
      return { split: false, wrap: true, words: true, whitespace: false };
    }
  });
  const [selection, setSelection] = useState<Selection | null>(null),
    [extra, setExtra] = useState<DiffLine[]>(() => {
      try {
        return JSON.parse(
          sessionStorage.getItem(`ordiff.context.${version}.${section.id}`) ||
            "[]",
        );
      } catch {
        return [];
      }
    }),
    [message, setMessage] = useState(""),
    [full, setFull] = useState(false),
    [side, setSide] = useState<"before" | "after">("after"),
    [page, setPage] = useState(1),
    [text, setText] = useState<TextPage | null>(null),
    [loading, setLoading] = useState(false);
  const [narrow, setNarrow] = useState(() =>
    typeof matchMedia === "function"
      ? matchMedia("(max-width: 1023px)").matches
      : false,
  );
  const [spans, setSpans] = useState<Record<number, [number, number]>>({});
  const root = useRef<HTMLDivElement>(null),
    request = useRef(0);
  useEffect(() => {
    try {
      sessionStorage.setItem(
        `ordiff.context.${version}.${section.id}`,
        JSON.stringify(extra),
      );
    } catch {
      /* optional session position */
    }
  }, [extra, section.id, version]);
  const base = (section.lines || []).filter((l) => expanded || !l.extra);
  const lines = useMemo(
    () => [
      ...extra.filter(
        (l) => (l.new ?? l.old ?? 0) < (base[0]?.new ?? base[0]?.old ?? 0),
      ),
      ...base,
      ...extra.filter(
        (l) =>
          (l.new ?? l.old ?? 0) > (base.at(-1)?.new ?? base.at(-1)?.old ?? 0),
      ),
    ],
    [section, extra, expanded],
  );
  const [diffPage, setDiffPage] = useState(0);
  const rendered = useMemo(
    () => lines.slice(diffPage, diffPage + 500),
    [lines, diffPage],
  );
  useEffect(() => {
    if (!revealAnchor?.startLine || !revealAnchor.side) return;
    setSelection({
      side: revealAnchor.side,
      start: revealAnchor.startLine,
      end: revealAnchor.endLine || revealAnchor.startLine,
    });
    const index = lines.findIndex(
      (l) =>
        (revealAnchor.side === "before" ? l.old : l.new) ===
        revealAnchor.startLine,
    );
    if (index >= 0) {
      setDiffPage(Math.floor(index / 500) * 500);
      requestAnimationFrame(() =>
        root.current
          ?.querySelector(
            `[data-${revealAnchor.side}="${revealAnchor.startLine}"]`,
          )
          ?.scrollIntoView?.({ block: "center" }),
      );
    } else if (section.fileId) {
      setSide(revealAnchor.side);
      setPage(Math.floor((revealAnchor.startLine - 1) / 200) * 200 + 1);
      setFull(true);
    }
  }, [revealAnchor]);
  const highlighted = useMemo(
    () => highlightDiff({ ...section, lines: rendered }),
    [section, rendered],
  );
  useEffect(() => {
    const media = matchMedia("(max-width: 1023px)");
    const change = () => setNarrow(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("ordiff.diff-display", JSON.stringify(display));
    } catch {
      /* preferences are optional */
    }
  }, [display]);
  useEffect(() => {
    if (!display.words || typeof Worker === "undefined") return;
    const worker = new Worker(
      new URL("../lib/word-diff.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (e) => setSpans(e.data);
    worker.postMessage(lines);
    return () => worker.terminate();
  }, [lines, display.words]);
  async function loadText(
    side: "before" | "after",
    start: number,
    limit = 200,
  ): Promise<TextPage> {
    const response = await fetch(
      `/api/snapshots/${encodeURIComponent(version!)}/files/${encodeURIComponent(section.fileId!)}/text?side=${side}&start=${start}&limit=${limit}`,
    );
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || data.message || "Text unavailable.");
    return data;
  }
  useEffect(() => {
    if (!full || !section.fileId) return;
    const sequence = ++request.current;
    setLoading(true);
    setMessage("");
    void loadText(side, page)
      .then((data) => {
        if (sequence === request.current) setText(data);
      })
      .catch((error) => {
        if (sequence === request.current) {
          setText(null);
          setMessage(error.message);
        }
      })
      .finally(() => {
        if (sequence === request.current) setLoading(false);
      });
    return () => {
      request.current++;
    };
  }, [full, side, page, section.fileId, version]);
  async function context(direction: "above" | "below") {
    setLoading(true);
    setMessage("");
    try {
      const first = lines.find((l) => l.old !== null && l.new !== null),
        last = [...lines]
          .reverse()
          .find((l) => l.old !== null && l.new !== null);
      const anchor = direction === "above" ? first : last;
      if (!anchor)
        throw new Error("Use View full file to inspect this revision.");
      const oldStart =
          direction === "above"
            ? Math.max(1, anchor.old! - 20)
            : anchor.old! + 1,
        newStart =
          direction === "above"
            ? Math.max(1, anchor.new! - 20)
            : anchor.new! + 1;
      const count =
        direction === "above"
          ? Math.min(20, anchor.old! - 1, anchor.new! - 1)
          : 20;
      if (count <= 0) {
        setMessage("Start of file.");
        return;
      }
      const [before, after] = await Promise.all([
        loadText("before", oldStart, count),
        loadText("after", newStart, count),
      ]);
      const additions: DiffLine[] = [];
      for (
        let i = 0;
        i < Math.min(before.lines.length, after.lines.length);
        i++
      ) {
        if (before.lines[i].text !== after.lines[i].text) break;
        additions.push({
          type: "context",
          text: before.lines[i].text,
          old: before.lines[i].number,
          new: after.lines[i].number,
        });
      }
      setExtra((previous) => [
        ...previous,
        ...additions.filter(
          (l) =>
            !lines.some(
              (existing) => existing.old === l.old && existing.new === l.new,
            ),
        ),
      ]);
      if (!additions.length)
        setMessage("No more unchanged context here. Use View full file.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not load context.",
      );
    } finally {
      setLoading(false);
    }
  }
  function select(side: "before" | "after", number: number, extend: boolean) {
    setSelection((previous) =>
      extend && previous?.side === side
        ? { side, start: previous.start, end: number }
        : { side, start: number, end: number },
    );
  }
  function comment() {
    if (!selection) return;
    const start = Math.min(selection.start, selection.end),
      end = Math.max(selection.start, selection.end);
    if (end - start >= 100) {
      setMessage("Select at most 100 lines.");
      return;
    }
    const chosen = full
      ? (text?.lines || [])
          .filter((l) => l.number >= start && l.number <= end)
          .map((l) => l.text)
      : lines
          .filter((l) => {
            const n = selection.side === "before" ? l.old : l.new;
            return n !== null && n >= start && n <= end;
          })
          .map((l) => l.text);
    const quote = chosen.join("\n");
    if (new TextEncoder().encode(quote).length > 16384) {
      setMessage("Select no more than 16 KiB of text.");
      return;
    }
    onAddComment?.("section", {
      snapshotId: version || "sample",
      fileId: section.fileId || section.id,
      path: section.path,
      sectionId: section.id,
      side: selection.side,
      startLine: start,
      endLine: end,
      quote,
    });
    setFull(false);
  }
  function number(side: "before" | "after", n: number | null) {
    const count = comments.filter(
      (c) =>
        c.anchor?.snapshotId === version &&
        c.anchor?.side === side &&
        n !== null &&
        n >= c.anchor.startLine! &&
        n <= c.anchor.endLine!,
    ).length;
    return n === null ? (
      <span className="line-number" />
    ) : (
      <button
        type="button"
        className="line-number"
        aria-label={`Select ${side} line ${n}`}
        aria-description={count ? `${count} comments` : undefined}
        aria-pressed={
          selection?.side === side &&
          n >= Math.min(selection.start, selection.end) &&
          n <= Math.max(selection.start, selection.end)
        }
        onClick={(event) => select(side, n, event.shiftKey)}
        onKeyDown={(event) => {
          if (event.shiftKey && ["ArrowUp", "ArrowDown"].includes(event.key)) {
            event.preventDefault();
            select(
              side,
              Math.max(
                1,
                (selection?.side === side ? selection.end : n) +
                  (event.key === "ArrowDown" ? 1 : -1),
              ),
              true,
            );
          }
        }}
      >
        {n}
        {count > 0 && (
          <span className="line-comment-count" aria-hidden="true">
            {" "}
            •
          </span>
        )}
      </button>
    );
  }
  function code(line: DiffLine, index: number) {
    if (query) {
      const lower = line.text.toLowerCase(),
        q = query.toLowerCase();
      const pieces = [];
      let from = 0,
        found = lower.indexOf(q);
      while (found !== -1) {
        pieces.push(
          line.text.slice(from, found),
          <mark key={found} data-search-match={`${index}:${found}`}>
            {line.text.slice(found, found + q.length)}
          </mark>,
        );
        from = found + q.length;
        found = lower.indexOf(q, from);
      }
      pieces.push(line.text.slice(from));
      return pieces;
    }
    const span = display.words ? spans[index] : undefined;
    if (span)
      return (
        <>
          {line.text.slice(0, span[0])}
          <mark className="word-change">
            {line.text.slice(span[0], span[1])}
          </mark>
          {line.text.slice(span[1])}
        </>
      );
    return (highlighted[index - diffPage] || [{ text: line.text }]).map(
      (token, i) => (
        <span className={token.className} key={i}>
          {token.text}
        </span>
      ),
    );
  }
  const whitespaceOnly =
    base
      .filter((l) => l.type === "remove")
      .map((l) => l.text.replace(/\s/g, ""))
      .join("") ===
      base
        .filter((l) => l.type === "add")
        .map((l) => l.text.replace(/\s/g, ""))
        .join("") && base.some((l) => l.type !== "context");
  const split = display.split && !narrow;
  const rows: {
    before?: { line: DiffLine; index: number };
    after?: { line: DiffLine; index: number };
  }[] = [];
  for (let i = diffPage; i < Math.min(lines.length, diffPage + 500); i++) {
    const line = lines[i];
    if (line.type === "context") {
      rows.push({ before: { line, index: i }, after: { line, index: i } });
      continue;
    }
    const removed: { line: DiffLine; index: number }[] = [],
      added: { line: DiffLine; index: number }[] = [];
    while (
      i < Math.min(lines.length, diffPage + 500) &&
      lines[i].type !== "context"
    ) {
      (lines[i].type === "remove" ? removed : added).push({
        line: lines[i],
        index: i,
      });
      i++;
    }
    i--;
    for (let k = 0; k < Math.max(removed.length, added.length); k++)
      rows.push({ before: removed[k], after: added[k] });
  }
  const matches = useMemo(() => {
    const result: { row: number; column: number }[] = [];
    if (!query) return result;
    const q = query.toLowerCase();
    lines.forEach((line, row) => {
      let column = line.text.toLowerCase().indexOf(q);
      while (column !== -1 && result.length < 20000) {
        result.push({ row, column });
        column = line.text.toLowerCase().indexOf(q, column + q.length);
      }
    });
    return result;
  }, [lines, query]);
  const [matchIndex, setMatchIndex] = useState(0);
  function jumpMatch(delta: number) {
    if (!matches.length) return;
    const index = (matchIndex + delta + matches.length) % matches.length;
    setMatchIndex(index);
    setDiffPage(Math.floor(matches[index].row / 500) * 500);
  }
  useEffect(() => {
    setMatchIndex(0);
    if (matches[0]) setDiffPage(Math.floor(matches[0].row / 500) * 500);
  }, [query]);
  useEffect(() => {
    const match = matches[matchIndex];
    if (match)
      root.current
        ?.querySelector(`[data-search-match="${match.row}:${match.column}"]`)
        ?.scrollIntoView?.({ block: "center" });
  }, [matchIndex, diffPage, query]);
  return (
    <div
      ref={root}
      className={`text-review ${display.wrap ? "wrap-lines" : ""}`}
    >
      <div className="diff-display-bar">
        <details>
          <summary>Diff display</summary>
          <div className="display-options">
            {(["split", "wrap", "words", "whitespace"] as const).map((key) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={display[key]}
                  onChange={(e) =>
                    setDisplay({ ...display, [key]: e.target.checked })
                  }
                />
                {
                  {
                    split: "Split view",
                    wrap: "Wrap lines",
                    words: "Word highlighting",
                    whitespace: "Hide whitespace-only changes",
                  }[key]
                }
              </label>
            ))}
          </div>
        </details>
        {section.fileId && (
          <Button
            variant="link"
            onClick={() => {
              setFull(true);
              setPage(1);
              setSelection(null);
            }}
          >
            View full file
          </Button>
        )}
        {selection && (
          <Button variant="link" onClick={comment}>
            Comment on selected lines
          </Button>
        )}
        {query && (
          <>
            <Button variant="link" onClick={() => jumpMatch(-1)}>
              Previous match
            </Button>
            <Button variant="link" onClick={() => jumpMatch(1)}>
              Next match
            </Button>
          </>
        )}
      </div>
      {lines.length > 500 && (
        <div className="diff-display-bar">
          <span>
            {diffPage + 1}–{Math.min(diffPage + 500, lines.length)} of{" "}
            {lines.length} diff lines
          </span>
          <Button
            variant="link"
            disabled={diffPage === 0}
            onClick={() => setDiffPage(Math.max(0, diffPage - 500))}
          >
            Previous diff lines
          </Button>
          <Button
            variant="link"
            disabled={diffPage + 500 >= lines.length}
            onClick={() => setDiffPage(diffPage + 500)}
          >
            Next diff lines
          </Button>
        </div>
      )}
      {display.whitespace && (
        <p className="field-hint">
          Whitespace-only changes are hidden for reading. Review counts are
          unchanged.{" "}
          <Button
            variant="link"
            onClick={() => setDisplay({ ...display, whitespace: false })}
          >
            Reveal whitespace
          </Button>
        </p>
      )}
      {section.fileId && (
        <Button
          variant="link"
          disabled={loading}
          onClick={() => void context("above")}
        >
          Show 20 lines above
        </Button>
      )}
      {display.whitespace && whitespaceOnly ? (
        <p className="plan-notice">
          This section contains whitespace-only changes.
        </p>
      ) : split ? (
        <div
          className="split-code"
          role="region"
          aria-label={`${section.path} code diff`}
          tabIndex={0}
        >
          {rows.map((row, index) => (
            <div className="split-row" key={index}>
              {(["before", "after"] as const).map((side) => {
                const cell = row[side];
                return (
                  <div
                    key={side}
                    className={`split-cell ${cell?.line.type || ""}`}
                    data-split-side={side}
                    onScroll={(event) => {
                      const position = event.currentTarget.scrollLeft;
                      root.current
                        ?.querySelectorAll<HTMLElement>(
                          `[data-split-side="${side}"]`,
                        )
                        .forEach((element) => {
                          if (Math.abs(element.scrollLeft - position) > 1)
                            element.scrollLeft = position;
                        });
                    }}
                  >
                    {cell && (
                      <>
                        {number(
                          side,
                          side === "before" ? cell.line.old : cell.line.new,
                        )}
                        <code>{code(cell.line, cell.index)}</code>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : (
        <div
          className="diff-code"
          role="region"
          aria-label={`${section.path} code diff`}
          tabIndex={0}
        >
          {rendered.map((line, offset) => {
            const index = offset + diffPage;
            return (
              <div
                className={`diff-line ${line.type}`}
                key={`${line.old}:${line.new}:${index}`}
                data-line={line.new ?? line.old}
                data-before={line.old}
                data-after={line.new}
              >
                {number("before", line.old)}
                {number("after", line.new)}
                <span
                  className="diff-marker"
                  aria-label={
                    line.type === "add"
                      ? "Added"
                      : line.type === "remove"
                        ? "Removed"
                        : "Unchanged"
                  }
                >
                  {line.type === "add"
                    ? "+"
                    : line.type === "remove"
                      ? "−"
                      : ""}
                </span>
                <code>{code(line, index)}</code>
              </div>
            );
          })}
        </div>
      )}
      {section.fileId && (
        <Button
          variant="link"
          disabled={loading}
          onClick={() => void context("below")}
        >
          Show 20 lines below
        </Button>
      )}
      <span role="status" className="field-hint">
        {message}
      </span>
      <NativeDialog
        open={full}
        onClose={() => setFull(false)}
        titleId="full-file-title"
        className="sheet-dialog full-file-dialog"
      >
        <header>
          <h2 id="full-file-title">{section.path}</h2>
          <Button variant="secondary" onClick={() => setFull(false)}>
            Return to section
          </Button>
        </header>
        <div className="diff-display-bar">
          <label>
            Revision
            <select
              value={side}
              onChange={(e) => {
                setSide(e.target.value as "before" | "after");
                setPage(1);
                setSelection(null);
              }}
            >
              <option value="before">Before</option>
              <option value="after">After</option>
            </select>
          </label>
          <Button
            variant="link"
            disabled={page === 1}
            onClick={() => setPage(Math.max(1, page - 200))}
          >
            Previous lines
          </Button>
          <Button
            variant="link"
            disabled={!text || page + 200 > text.totalLines}
            onClick={() => setPage(page + 200)}
          >
            Next lines
          </Button>
          {selection && (
            <Button variant="link" onClick={comment}>
              Comment on selected lines
            </Button>
          )}
        </div>
        <p role="status">
          {loading
            ? "Loading captured text…"
            : message ||
              `${page}–${Math.min(page + 199, text?.totalLines || 0)} of ${text?.totalLines || 0} lines`}
        </p>
        <div className="full-file-code">
          {text?.lines.map((line) => (
            <div key={line.number}>
              {number(side, line.number)}
              <code>{line.text}</code>
            </div>
          ))}
        </div>
      </NativeDialog>
    </div>
  );
}
