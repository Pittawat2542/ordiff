import { Fragment, memo, type ReactNode } from "react";
import { Icon, roleIcons } from "./icons";
import { changeCounts } from "./data";
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
function Syntax({ text }: { text: string }) {
  const expression =
    /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`|\/\/.*$|\b(?:export|import|from|type|const|let|return|function|async|await|if|throw|new|null|true|false|describe|it|expect)\b|\b\d+\b|\b[A-Z][A-Za-z0-9]*(?=[\s<{.(]))/g;
  const output: ReactNode[] = [];
  let position = 0;
  for (const match of text.matchAll(expression)) {
    output.push(text.slice(position, match.index));
    const value = match[0];
    const type = /^("|'|`)/.test(value)
      ? "string"
      : value.startsWith("//")
        ? "comment"
        : /^\d/.test(value)
          ? "number"
          : /^[A-Z]/.test(value)
            ? "type"
            : "keyword";
    output.push(
      <span className={`token-${type}`} key={match.index}>
        {value}
      </span>,
    );
    position = match.index + value.length;
  }
  output.push(text.slice(position));
  return (
    <>
      {output.map((part, index) => (
        <Fragment key={index}>{part}</Fragment>
      ))}
    </>
  );
}
export const DiffView = memo(function DiffView({
  section,
  expanded = false,
  onToggleContext,
}: {
  section: DiffSection;
  expanded?: boolean;
  onToggleContext?: () => void;
}) {
  const split = section.path.lastIndexOf("/");
  const allLines = section.lines || [];
  const lines = allLines.filter((line) => expanded || !line.extra);
  return (
    <article className="diff-card active-card" id="active-diff">
      <div className="diff-card-header">
        <span className={`file-type ${section.role.toLowerCase()}`}>
          <Icon name={roleIcons[section.role] || "file"} />
        </span>
        <div className="file-title">
          <span className="file-path">
            <span>{section.path.slice(0, split + 1)}</span>
            <strong>{section.path.slice(split + 1)}</strong>
          </span>
        </div>
        <span className="diff-counts">
          <ChangeCounts sections={[section]} />
        </span>
      </div>
      <div className="hunk-heading">
        <span>
          <Icon name="code" />
          <span>{section.symbol || "Changed section"}</span>
        </span>
        <span>{section.language}</span>
      </div>
      {section.binary ? (
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
                {line.type === "add" ? "+" : line.type === "remove" ? "−" : ""}
              </span>
              <code>
                {["Markdown", "Environment", "Configuration"].includes(
                  section.language || "",
                ) ? (
                  line.text
                ) : (
                  <Syntax text={line.text || " "} />
                )}
              </code>
            </div>
          ))}
        </div>
      )}
      {allLines.some((line) => line.extra) && (
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
});
