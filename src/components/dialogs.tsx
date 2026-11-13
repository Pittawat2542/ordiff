import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useExitPresence } from "../hooks/use-exit-presence";
import { Icon } from "../icons";
import type { ReviewController } from "../hooks/use-review";
import type { ReviewAction } from "../types";
import { Button } from "./ui/button";
import { Brand } from "./brand";
import { RepositoryChooser } from "./repository-chooser";
import { Textarea } from "./ui/textarea";
import { TextDiffLink } from "./text-diff-link";

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
  const { present, exiting } = useExitPresence(open, ref);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (present && !dialog.open) dialog.showModal();
    else if (!present && dialog.open) dialog.close();
  }, [present]);
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
      closedby="closerequest"
      data-exiting={exiting ? "" : undefined}
      onClose={(event) => {
        if (open && !event.currentTarget.open) onClose();
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (open) onClose();
      }}
      onKeyDownCapture={(event) => {
        if (exiting) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onPointerDown={(event) => {
        pressedOutside.current = outside(event.clientX, event.clientY);
      }}
      onPointerUp={(event) => {
        if (pressedOutside.current && outside(event.clientX, event.clientY))
          onClose();
        pressedOutside.current = false;
      }}
    >
      {present ? children : null}
    </dialog>
  );
}

export function Onboarding({ review }: { review: ReviewController }) {
  return (
    <section className="onboarding">
      <div className="welcome-mark">
        <Brand />
      </div>
      <h1>Follow the change.</h1>
      <p className="welcome-description">
        Open a local repository to start your review.
      </p>
      <RepositoryChooser review={review} />
      <div className="welcome-secondary">
        <Button variant="link" onClick={review.startDemo}>
          Try the sample review
        </Button>
        <TextDiffLink />
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
  buildPrompt,
}: {
  kind: DialogKind | null;
  close: () => void;
  review: ReviewController;
  openRepository: () => void;
  navigate: (action: ReviewAction) => void;
  buildPrompt: () => void;
}) {
  // Keep the last sheet's contents while its controlled open state exits.
  const [lastKind, setLastKind] = useState(kind);
  if (kind && kind !== lastKind) setLastKind(kind);
  const displayKind = kind || lastKind;
  const icon =
    displayKind === "repository"
      ? "repo"
      : displayKind === "mcp"
        ? "sparkle"
        : displayKind === "summary"
          ? "check"
          : "keyboard";
  const closeLabel =
    displayKind === "repository"
      ? "Close repository settings"
      : displayKind === "mcp"
        ? "Close agent setup"
        : displayKind === "summary"
          ? "Close summary"
          : "Close help";
  return (
    <NativeDialog
      open={!!kind}
      onClose={close}
      titleId={displayKind ? titles[displayKind] : undefined}
      className={`sheet-dialog ${displayKind === "mcp" ? "mcp-dialog" : displayKind === "repository" ? "repository-dialog" : ""}`}
      id={displayKind ? `${displayKind}-dialog` : undefined}
    >
      {displayKind && (
        <>
          <div className="dialog-heading flex items-center justify-between">
            {displayKind === "repository" ? (
              <h2 id="repository-title">Open a repository</h2>
            ) : (
              <span className="dialog-emblem">
                {displayKind === "help" ? "?" : <Icon name={icon} />}
              </span>
            )}
            <Button variant="ghost" aria-label={closeLabel} onClick={close}>
              <Icon name="close" />
            </Button>
          </div>
          {displayKind === "repository" && (
            <>
              <p className="dialog-intro">Choose a local Git checkout.</p>
              <RepositoryChooser
                review={review}
                inDialog
                active={kind === "repository"}
                onConnected={close}
                footerAction={
                  review.workspace && (
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
                  )
                }
              />
            </>
          )}
          {displayKind === "mcp" && (
            <McpSetup review={review} openRepository={openRepository} />
          )}
          {displayKind === "summary" && (
            <ReviewSummary
              review={review}
              close={close}
              navigate={navigate}
              buildPrompt={buildPrompt}
            />
          )}
          {displayKind === "help" && (
            <>
              <h2 id="help-title">A clearer review.</h2>
              <p className="dialog-intro">
                Open a local repository, review the changes, and add file or
                section comments. Build a prompt from selected feedback and
                general instructions. Connect an agent through MCP whenever you
                want a guided reading path.
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
                  <span>Defer and continue</span><kbd>D</kbd>
                </div><div>
                  <span>Open help</span>
                  <kbd>?</kbd>
                </div>
              </div>
              <div className="repository-access-note">
                <strong>Your repository stays yours.</strong>
                <p>
                  Git access is read-only. Use Refresh to pick up file edits.
                  Review progress and feedback stay on this computer; your repo
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
  buildPrompt,
}: {
  review: ReviewController;
  close: () => void;
  navigate: (action: ReviewAction) => void;
  buildPrompt: () => void;
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
        className="wide-button summary-build-prompt"
        onClick={buildPrompt}
      >
        Build prompt <Icon name="arrow" />
      </Button>
      <Button
        variant="secondary"
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
