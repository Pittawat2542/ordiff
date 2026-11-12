import { Fragment, lazy, memo, Suspense, useMemo, useState } from "react";
import {
  fileUrl,
  formatSize,
  MAX_PREVIEW_BYTES,
  previewKind,
} from "./lib/file-preview";
const FilePreview = lazy(() => import("./components/file-preview"));
import { highlightDiff } from "./lib/highlight";
import { Icon, roleIcons } from "./icons";
import { changeCounts } from "./lib/diff";
import { Button } from "./components/ui/button";
import type { DiffSection } from "./types";

export function ChangeCounts({ sections }: { sections: DiffSection[] }) {
  const count = changeCounts(sections);
  return (
    <>
      <span className="add-count">+{count.add}</span>
      <span className="remove-count">−{count.remove}</span>
    </>
  );
}
interface DiffViewProps {
  section: DiffSection;
  expanded?: boolean;
  onToggleContext?: () => void;
  version?: string;
  onAddComment?: (scope: "file" | "section") => void;
}
export const DiffView = memo(function DiffView(props: DiffViewProps) {
  return (
    <DiffPanel
      key={`${props.section.id}:${props.version || "sample"}`}
      {...props}
    />
  );
});
function DiffPanel({
  section,
  expanded = false,
  onToggleContext,
  version,
  onAddComment,
}: DiffViewProps) {
  const kind = previewKind(section);
  const canPreview = kind !== "unsupported" || section.binary;
  const compareVersions = Boolean(
    section.file?.before &&
    section.file.after &&
    (section.binary || !["markdown", "csv", "unsupported"].includes(kind)),
  );
  const [mode, setMode] = useState<"diff" | "preview">(
    section.binary ? "preview" : "diff",
  );
  const [side, setSide] = useState<"before" | "after">(
    section.file?.after === null ? "before" : "after",
  );
  const revision = section.file?.[side];
  const download =
    section.file && version && revision && revision.size <= MAX_PREVIEW_BYTES
      ? fileUrl(section.id, version, side)
      : undefined;
  const split = section.path.lastIndexOf("/");
  const allLines = section.lines || [];
  const lines = allLines
    .map((line, index) => ({ ...line, index }))
    .filter((line) => expanded || !line.extra);
  const highlighted = useMemo(() => highlightDiff(section), [section]);
  return (
    <article className="diff-card" id="active-diff">
      <div className="diff-sticky-header">
        <div className="diff-card-header">
          <span className="file-type">
            <Icon name={roleIcons[section.role] || "file"} />
          </span>
          <div className="file-title">
            <span className="file-path">
              <span>{section.path.slice(0, split + 1)}</span>
              <strong>{section.path.slice(split + 1)}</strong>
            </span>
          </div>
          <span className="diff-counts" hidden={section.binary}>
            <ChangeCounts sections={[section]} />
          </span>
          {onAddComment && (
            <Button
              variant="link"
              className="add-file-comment"
              aria-label="Add file comment"
              onClick={() => onAddComment("file")}
            >
              <Icon name="plus" />
              <span>Add comment</span>
            </Button>
          )}
        </div>
        <div className="hunk-heading">
          <span>
            <Icon name="code" />
            <span>{section.symbol || "Changed section"}</span>
          </span>
          <span className="hunk-actions">
            <span>{section.language}</span>
            {onAddComment && (
              <Button
                variant="link"
                aria-label="Add section comment"
                onClick={() => onAddComment("section")}
              >
                <Icon name="plus" />
                <span>Comment on section</span>
              </Button>
            )}
          </span>
        </div>
      </div>
      {canPreview && (
        <div className="file-view-toolbar">
          <div className="file-view-tabs" role="tablist" aria-label="File view">
            {(["diff", "preview"] as const).map((view) => (
              <Button
                variant="unstyled"
                key={view}
                role="tab"
                id={`file-tab-${view}`}
                aria-selected={mode === view}
                aria-controls="file-view-panel"
                tabIndex={mode === view ? 0 : -1}
                onClick={() => setMode(view)}
                onKeyDown={(event) => {
                  if (
                    ["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                      event.key,
                    )
                  ) {
                    event.preventDefault();
                    const next =
                      event.key === "Home"
                        ? "diff"
                        : event.key === "End"
                          ? "preview"
                          : mode === "diff"
                            ? "preview"
                            : "diff";
                    setMode(next);
                    document.getElementById(`file-tab-${next}`)?.focus();
                  }
                }}
              >
                {view === "preview"
                  ? "Preview"
                  : section.binary
                    ? "Details"
                    : "Diff"}
              </Button>
            ))}
          </div>
          {mode === "preview" &&
            !compareVersions &&
            section.file?.before &&
            section.file.after && (
              <div
                className="file-version-switch"
                role="group"
                aria-label="File version"
              >
                <Button
                  variant="unstyled"
                  aria-pressed={side === "before"}
                  onClick={() => setSide("before")}
                >
                  Original
                </Button>
                <Button
                  variant="unstyled"
                  aria-pressed={side === "after"}
                  onClick={() => setSide("after")}
                >
                  Working tree
                </Button>
              </div>
            )}
          {download && !(mode === "preview" && compareVersions) && (
            <a
              className="file-download"
              href={download}
              download={section.path.split("/").at(-1)}
            >
              Download <Icon name="arrow" />
            </a>
          )}
        </div>
      )}
      <div
        id="file-view-panel"
        role={canPreview ? "tabpanel" : undefined}
        aria-labelledby={canPreview ? `file-tab-${mode}` : undefined}
      >
        {canPreview && mode === "preview" ? (
          compareVersions ? (
            <FileComparison section={section} version={version} />
          ) : (
            <Suspense
              fallback={
                <div className="preview-loading" role="status">
                  Opening preview…
                </div>
              }
            >
              <FilePreview section={section} version={version} side={side} />
            </Suspense>
          )
        ) : section.binary ? (
          <div className="binary-change">
            <Icon name="file" />
            <p>
              {allLines[0]?.text || "Inspect this binary file in your editor."}
            </p>
          </div>
        ) : (
          <div
            className="diff-code"
            tabIndex={0}
            role="region"
            aria-label={`${section.path} code diff`}
          >
            {lines.map((line, index) => (
              <div className={`diff-line ${line.type}`} key={index}>
                <span className="line-number old">{line.old ?? ""}</span>
                <span className="line-number new">{line.new ?? ""}</span>
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
                <code>
                  {(highlighted[line.index] || [{ text: line.text }]).map(
                    (token, index) =>
                      token.className ? (
                        <span className={token.className} key={index}>
                          {token.text}
                        </span>
                      ) : (
                        <Fragment key={index}>{token.text}</Fragment>
                      ),
                  )}
                </code>
              </div>
            ))}
          </div>
        )}
      </div>
      {mode === "diff" && allLines.some((line) => line.extra) && (
        <div className="diff-card-footer">
          <Button
            variant="unstyled"
            className="context-button"
            aria-expanded={expanded}
            onClick={onToggleContext}
          >
            <Icon name="code" />
            {expanded ? "Hide extra context" : "Show surrounding context"}
          </Button>
        </div>
      )}
    </article>
  );
}

function FileComparison({ section, version }: DiffViewProps) {
  return (
    <div className="file-comparison" role="group" aria-label="File comparison">
      <div className="file-comparison-grid">
        {(["before", "after"] as const).map((side) => {
          const revision = section.file![side]!;
          const original = side === "before";
          return (
            <section
              key={side}
              className="file-comparison-pane"
              aria-label={original ? "Original file" : "Working tree file"}
            >
              <div className="file-comparison-header">
                <h3>{original ? "Original" : "Working tree"}</h3>
                <span>{formatSize(revision.size)}</span>
                {version && revision.size <= MAX_PREVIEW_BYTES && (
                  <a
                    className="file-download"
                    href={fileUrl(section.id, version, side)}
                    download={section.path.split("/").at(-1)}
                    aria-label={
                      original
                        ? "Download original file"
                        : "Download working tree file"
                    }
                  >
                    Download <Icon name="arrow" />
                  </a>
                )}
              </div>
              <Suspense
                fallback={
                  <div className="preview-loading" role="status">
                    Opening preview…
                  </div>
                }
              >
                <FilePreview
                  section={section}
                  version={version}
                  side={side}
                  showCaption={false}
                />
              </Suspense>
            </section>
          );
        })}
      </div>
    </div>
  );
}
