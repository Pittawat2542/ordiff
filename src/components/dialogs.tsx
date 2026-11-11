import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../icons";
import type { ReviewController } from "../hooks/use-review";
import type { ReviewAction } from "../types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";

export function NativeDialog({
  open,
  onClose,
  titleId,
  label,
  className = "sheet-dialog",
  id,
  children,
}: {
  open: boolean;
  onClose: () => void;
  titleId?: string;
  label?: string;
  className?: string;
  id?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const pressedOutside = useRef(false);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  function outside(x: number, y: number) {
    const rect = ref.current?.getBoundingClientRect();
    return (
      !!rect &&
      (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom)
    );
  }
  return (
    <dialog
      ref={ref}
      id={id}
      className={className}
      aria-labelledby={titleId}
      aria-label={label}
      closedby="any"
      onClose={onClose}
      onPointerDown={(event) => {
        pressedOutside.current = outside(event.clientX, event.clientY);
      }}
      onPointerUp={(event) => {
        if (pressedOutside.current && outside(event.clientX, event.clientY))
          ref.current?.close();
        pressedOutside.current = false;
      }}
    >
      {children}
    </dialog>
  );
}

export function RepositoryForm({
  review,
  inDialog = false,
  onConnected,
}: {
  review: ReviewController;
  inDialog?: boolean;
  onConnected?: () => void;
}) {
  const initialPath =
    inDialog && review.mode === "git"
      ? review.workspace?.repo.path || ""
      : review.defaultPath;
  const [path, setPath] = useState(initialPath);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!dirty) setPath(initialPath);
  }, [initialPath, dirty]);
  const inputId = inDialog ? "dialog-repo-path" : "repo-path",
    errorId = inDialog ? "dialog-repo-error" : "repo-error";
  return (
    <form
      className="connect-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setError("");
        try {
          if (await review.connectRepository(path)) onConnected?.();
        } catch (error) {
          setError(
            error instanceof Error
              ? error.message
              : "The repository could not be opened.",
          );
        }
      }}
    >
      <label htmlFor={inputId}>
        {inDialog ? "Repository path" : "Local repository"}
      </label>
      <div className="repo-input-wrap">
        {!inDialog && <Icon name="repo" />}
        <Input
          id={inputId}
          name="path"
          type="text"
          value={path}
          onChange={(event) => {
            setDirty(true);
            setPath(event.target.value);
          }}
          placeholder={inDialog ? undefined : "/path/to/your/repository"}
          required
          autoComplete="off"
          spellCheck={false}
          autoFocus={inDialog}
          aria-describedby={inDialog ? errorId : `repo-hint ${errorId}`}
        />
      </div>
      {!inDialog && (
        <p id="repo-hint" className="field-hint">
          Reads staged, unstaged, and untracked changes. Your Git files stay
          untouched.
        </p>
      )}
      <p id={errorId} className="form-error" role="alert">
        {error || (!inDialog ? review.serviceError : "")}
      </p>
      <Button className="wide-button" type="submit" disabled={review.busy}>
        {review.busy ? "Opening…" : "Open repository"}
        {!inDialog && <Icon name="arrow" />}
      </Button>
    </form>
  );
}
export function Onboarding({ review }: { review: ReviewController }) {
  return (
    <section className="onboarding">
      <div className="welcome-mark">
        <Icon name="branch" />
      </div>
      <p className="eyebrow">A LITTLE LESS TO HOLD IN YOUR HEAD</p>
      <h1>
        Follow the change.
        <br />
        Keep the context.
      </h1>
      <p className="welcome-description">
        A calmer review starts with your repository.
        <br />
        Connect your agent to follow one behavior across files.
      </p>
      <RepositoryForm review={review} />
      <div className="welcome-secondary">
        <span>Just looking around?</span>
        <Button variant="link" onClick={review.startDemo}>
          Try the sample review <Icon name="arrow" />
        </Button>
      </div>
      <div className="welcome-steps">
        <span>
          <i>1</i>Open your repo
        </span>
        <span>
          <i>2</i>Connect your agent
        </span>
        <span>
          <i>3</i>Review by behavior
        </span>
      </div>
    </section>
  );
}
export type DialogKind = "repository" | "mcp" | "help" | "summary";
const titles = {
  repository: "repository-title",
  mcp: "mcp-title",
  help: "help-title",
  summary: "summary-title",
};
export function AppDialog({
  kind,
  close,
  review,
  openRepository,
  navigate,
}: {
  kind: DialogKind | null;
  close: () => void;
  review: ReviewController;
  openRepository: () => void;
  navigate: (action: ReviewAction) => void;
}) {
  const icon =
    kind === "repository"
      ? "repo"
      : kind === "mcp"
        ? "sparkle"
        : kind === "summary"
          ? "check"
          : "keyboard";
  const closeLabel =
    kind === "repository"
      ? "Close repository settings"
      : kind === "mcp"
        ? "Close agent setup"
        : kind === "summary"
          ? "Close summary"
          : "Close help";
  return (
    <NativeDialog
      open={!!kind}
      onClose={close}
      titleId={kind ? titles[kind] : undefined}
      className={`sheet-dialog ${kind === "mcp" ? "mcp-dialog" : ""}`}
      id={kind ? `${kind}-dialog` : undefined}
    >
      {kind && (
        <>
          <div className="dialog-heading flex items-center justify-between">
            <span className="dialog-emblem">
              {kind === "help" ? "?" : <Icon name={icon} />}
            </span>
            <Button variant="ghost" aria-label={closeLabel} onClick={close}>
              <Icon name="close" />
            </Button>
          </div>
          {kind === "repository" && (
            <>
              <h2 id="repository-title">Open a repository</h2>
              <p className="dialog-intro">
                Review the working changes in a local Git checkout.
              </p>
              <RepositoryForm review={review} inDialog onConnected={close} />
              {review.workspace && (
                <Button
                  variant="link"
                  className="disconnect-button"
                  disabled={review.busy}
                  onClick={async () => {
                    if (await review.disconnect()) close();
                  }}
                >
                  {review.mode === "demo"
                    ? "Close sample review"
                    : "Close repository"}
                </Button>
              )}
            </>
          )}
          {kind === "mcp" && (
            <McpSetup review={review} openRepository={openRepository} />
          )}
          {kind === "summary" && (
            <ReviewSummary review={review} close={close} navigate={navigate} />
          )}
          {kind === "help" && (
            <>
              <h2 id="help-title">A clearer review.</h2>
              <p className="dialog-intro">
                Open a local repository, then connect your agent through MCP to
                get a reading path. All changes stay accessible, with or without
                a path.
              </p>
              <div className="shortcut-list">
                <div>
                  <span>Search all changes</span>
                  <kbd>⌘ / Ctrl K</kbd>
                </div>
                <div>
                  <span>Next / previous section</span>
                  <span>
                    <kbd>J</kbd>
                    <kbd>K</kbd>
                  </span>
                </div>
                <div>
                  <span>Review or continue to the next pending section</span>
                  <kbd>R</kbd>
                </div>
                <div>
                  <span>Open help</span>
                  <kbd>?</kbd>
                </div>
              </div>
              <div className="repository-access-note">
                <strong>Your repository stays yours.</strong>
                <p>
                  Git access is read-only. Use Refresh to pick up file edits.
                  Review progress and notes stay in this browser; your repo
                  choice and agent plan stay locally in Ordiff.
                </p>
              </div>
            </>
          )}
        </>
      )}
    </NativeDialog>
  );
}
function McpSetup({
  review,
  openRepository,
}: {
  review: ReviewController;
  openRepository: () => void;
}) {
  const real = review.mode === "git";
  const [copied, setCopied] = useState(false);
  const configRef = useRef<HTMLTextAreaElement>(null);
  return (
    <>
      <h2 id="mcp-title">Give your agent a way in.</h2>
      <p className="dialog-intro">
        {real
          ? "Add Ordiff to your MCP client. Your agent can read this diff and propose a behavior-based reading path."
          : "Open a local repository first. The sample review is a preview of the experience."}
      </p>
      {real ? (
        <>
          <ol className="mcp-steps">
            <li>Keep Ordiff running.</li>
            <li>Add this local server to your MCP client.</li>
            <li>Ask your agent to read the diff and send a review plan.</li>
          </ol>
          <label className="config-label" htmlFor="mcp-config">
            MCP client configuration{" "}
            <Button
              variant="link"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    JSON.stringify(review.mcpConfig, null, 2),
                  );
                  setCopied(true);
                } catch {
                  configRef.current?.select();
                  review.announce("Select and copy the configuration.");
                }
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </label>
          <Textarea
            ref={configRef}
            className="mcp-config"
            id="mcp-config"
            readOnly
            rows={10}
            spellCheck={false}
            aria-label="MCP client configuration"
            value={JSON.stringify(review.mcpConfig, null, 2)}
          />
          <div className="tool-description">
            <code>get_review_context</code>
            <span>Read the current Git diff and section IDs.</span>
            <code>submit_review_plan</code>
            <span>Send ordered groups and explanations.</span>
          </div>
          <p className="mcp-footnote">
            Plans must match the current diff. These tools cannot mark code
            reviewed or change your Git files.
          </p>
        </>
      ) : (
        <Button className="wide-button" onClick={openRepository}>
          Open repository
        </Button>
      )}
    </>
  );
}
function ReviewSummary({
  review,
  close,
  navigate,
}: {
  review: ReviewController;
  close: () => void;
  navigate: (action: ReviewAction) => void;
}) {
  const progress = review.model.getProgress(review.state);
  const unassigned = review.model.sections.filter(
    (section) => !section.group && !review.state.reviewed.includes(section.id),
  ).length;
  return (
    <>
      <h2 id="summary-title">
        {progress.percent === 100
          ? "All changes reviewed."
          : "Your review so far."}
      </h2>
      <p className="dialog-intro">
        {progress.reviewed} of {progress.total} sections reviewed.
        {unassigned
          ? ` ${unassigned} ungrouped sections still need attention.`
          : ""}
      </p>
      <div className="summary-progress">
        <span style={{ width: `${progress.percent}%` }} />
      </div>
      <div className="summary-groups">
        {review.model.groups.map((group) => {
          const p = review.model.getProgress(review.state, group.id);
          return (
            <Button
              variant="unstyled"
              key={group.id}
              onClick={() => navigate({ type: "group", id: group.id })}
            >
              <span>{group.title}</span>
              <strong>
                {p.reviewed}/{p.total}
              </strong>
              <Icon name="chevron" />
            </Button>
          );
        })}
      </div>
      <Button
        className="wide-button"
        onClick={() => {
          close();
          review.browse(progress.percent === 100);
        }}
      >
        {progress.percent === 100 ? "View reviewed changes" : "Continue review"}{" "}
        <Icon name="arrow" />
      </Button>
    </>
  );
}
