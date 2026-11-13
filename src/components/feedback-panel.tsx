import { useId, useState } from "react";
import type { ReviewController } from "../hooks/use-review";
import type { FeedbackController } from "../hooks/use-feedback";
import {
  captureSection,
  feedbackStatus,
  intentLabels,
  sectionReference,
} from "../feedback";
import type {
  DiffSection,
  FeedbackComment,
  FeedbackIntent,
  Workspace,
} from "../types";
import { Icon } from "../icons";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

export function CommentEditor({
  comment,
  feedback,
  workspace,
  active,
  focus = false,
}: {
  comment: FeedbackComment;
  feedback: FeedbackController;
  workspace: Workspace;
  active?: DiffSection;
  focus?: boolean;
}) {
  const id = useId();
  const status = feedbackStatus(comment, workspace);
  return (
    <article
      className="feedback-comment"
      aria-label={`${intentLabels[comment.intent]} comment`}
    >
      <div className="comment-heading">
        <label className="sr-only" htmlFor={`${id}-intent`}>
          Comment intent
        </label>
        <select
          id={`${id}-intent`}
          className={`intent-select intent-${comment.intent}`}
          value={comment.intent}
          onChange={(event) =>
            feedback.update(comment.id, {
              intent: event.target.value as FeedbackIntent,
            })
          }
        >
          {Object.entries(intentLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          aria-label="Comment status"
          value={comment.status || "open"}
          onChange={(event) =>
            feedback.update(comment.id, {
              status: event.target.value as "open" | "addressed" | "resolved",
            })
          }
        >
          <option value="open">Open</option>
          <option value="addressed">Addressed</option>
          <option value="resolved">Resolved</option>
        </select>
        <span className="comment-scope">
          {comment.section ? "Section" : "Whole file"}
        </span>
        <Button
          variant="ghost"
          aria-label="Delete comment"
          title="Delete comment"
          onClick={() => feedback.remove(comment.id)}
        >
          <Icon name="trash" />
        </Button>
      </div>
      {comment.anchor && status === "current" && (
        <Button
          variant="link"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("ordiff:reveal-anchor", {
                detail: comment.anchor,
              }),
            )
          }
        >
          View referenced code
        </Button>
      )}
      {comment.anchor && (
        <details className="comment-reference" open>
          <summary>
            Captured {comment.anchor.side} L{comment.anchor.startLine}–
            {comment.anchor.endLine}
          </summary>
          <pre>{comment.anchor.quote}</pre>
        </details>
      )}
      {workspace.cycle?.reports
        .filter((r) => r.commentId === comment.id)
        .map((r) => (
          <p key={r.id} className="field-hint">
            Agent: {r.explanation}
            {r.commentRevision !== comment.revision
              ? " · Earlier comment revision"
              : ""}
          </p>
        ))}
      {comment.section && (
        <div className="comment-reference">
          <span>{comment.section.hunk}</span>
          <span>{sectionReference(comment.section)}</span>
        </div>
      )}
      {status !== "current" && (
        <div className="feedback-warning">
          <span>
            <Icon name="status" />
            Reference needs rechecking
          </span>
          <p>
            {status === "missing-file"
              ? "This file is no longer in the current diff."
              : "This section changed or is no longer in the current diff."}{" "}
            Your feedback is kept.
          </p>
          {comment.section && (
            <div className="reanchor-actions">
              {active?.path === comment.path && (
                <Button
                  variant="link"
                  onClick={() =>
                    feedback.update(comment.id, {
                      section: captureSection(active, workspace.version),anchor:undefined,
                    })
                  }
                >
                  Reassign to current section
                </Button>
              )}
              <Button
                variant="link"
                onClick={() =>
                  feedback.update(comment.id, { section: undefined,anchor:undefined })
                }
              >
                Make file comment
              </Button>
            </div>
          )}
        </div>
      )}
      <label className="sr-only" htmlFor={`${id}-text`}>
        Comment text
      </label>
      <Textarea
        id={`${id}-text`}
        value={comment.text}
        rows={3}
        autoFocus={focus}
        placeholder={
          comment.intent === "keep"
            ? "What works well and should stay?"
            : comment.intent === "note"
              ? "Context for your agent…"
              : "What would you like to change?"
        }
        onBlur={() => void feedback.flush()}
        onChange={(event) =>
          feedback.update(comment.id, { text: event.target.value })
        }
      />
    </article>
  );
}

export function GeneralInstructions({
  feedback,
  id,
}: {
  feedback: FeedbackController;
  id: string;
}) {
  return (
    <div className="general-instructions">
      <label htmlFor={id}>General instructions</label>
      <p>
        Direction for the whole task. Use it on its own or alongside file
        feedback.
      </p>
      <Textarea
        id={id}
        value={feedback.state.general}
        rows={6}
        placeholder="What else should your agent know or do?"
        onChange={(event) => feedback.setGeneral(event.target.value)}
      />
    </div>
  );
}

export function FeedbackPanel({
  review,
  tab,
  setTab,
  close,
  addComment,
  focusId,
  buildPrompt,
}: {
  review: ReviewController;
  tab: "file" | "general";
  setTab: (tab: "file" | "general") => void;
  close: () => void;
  addComment: (scope: "file" | "section") => void;
  focusId: string | null;
  buildPrompt: () => void;
}) {
  const { feedback, workspace, model, state } = review;
  const id = useId();
  const [statusFilter, setStatusFilter] = useState("all"),
    [commentLimit, setCommentLimit] = useState(100);
  const active = model.getActiveSection(state);
  const comments = feedback.state.comments.filter(
    (comment) =>
      comment.path === active?.path &&
      (statusFilter === "all" || (comment.status || "open") === statusFilter),
  );
  if (!workspace) return null;
  return (
    <div className="feedback-panel">
      <header className="feedback-panel-header">
        <div>
          <p className="eyebrow">YOUR NEXT ITERATION</p>
          <h2>
            Your feedback{" "}
            <span className="feedback-count">{feedback.count}</span>
          </h2>
        </div>
        <Button variant="ghost" aria-label="Close feedback" onClick={close}>
          <Icon name="close" />
        </Button>
      </header>
      <div className="cycle-save">
        <span role="status">{feedback.saveStatus}</span>
        {feedback.conflict && (
          <>
            <Button variant="link" onClick={() => void feedback.flush()}>
              Retry
            </Button>
            <Button variant="link" onClick={feedback.useLatest}>
              Use latest
            </Button>
            <Button variant="link" onClick={feedback.saveAsCopies}>
              Save as new comments
            </Button>
          </>
        )}
      </div>
      <label className="cycle-filter">
        Feedback status
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="all">All</option>
          <option value="open">Open</option>
          <option value="addressed">Addressed — verify</option>
          <option value="resolved">Resolved</option>
        </select>
      </label>
      <div className="feedback-tabs" role="tablist" aria-label="Feedback scope">
        {(["file", "general"] as const).map((value) => (
          <Button
            variant="unstyled"
            key={value}
            role="tab"
            id={`${id}-${value}`}
            aria-selected={tab === value}
            aria-controls={`${id}-panel`}
            tabIndex={tab === value ? 0 : -1}
            onClick={() => setTab(value)}
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? "file"
                  : event.key === "End"
                    ? "general"
                    : tab === "file"
                      ? "general"
                      : "file";
              setTab(next);
              document.getElementById(`${id}-${next}`)?.focus();
            }}
          >
            {value === "file" ? "This file" : "General instructions"}
          </Button>
        ))}
      </div>
      <div
        className="feedback-panel-body"
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-${tab}`}
      >
        {tab === "general" ? (
          <GeneralInstructions feedback={feedback} id={`${id}-general-text`} />
        ) : active ? (
          <>
            <p className="feedback-file-path">
              <Icon name="file" />
              <span>{active.path}</span>
            </p>
            <div className="feedback-add-actions">
              <Button variant="secondary" onClick={() => addComment("file")}>
                <Icon name="plus" />
                Whole-file comment
              </Button>
              <Button variant="link" onClick={() => addComment("section")}>
                Section comment
              </Button>
            </div>
            {!comments.length && (
              <div className="feedback-empty">
                <Icon name="note" />
                <h3>Leave a thought for your agent.</h3>
                <p>
                  What should change? What should stay? Comments become your
                  next prompt.
                </p>
              </div>
            )}
            {comments.slice(0, commentLimit).map((comment) => (
              <CommentEditor
                key={comment.id}
                comment={comment}
                feedback={feedback}
                workspace={workspace}
                active={active}
                focus={comment.id === focusId}
              />
            ))}
          </>
        ) : (
          <div className="feedback-empty">
            <Icon name="note" />
            <h3>No file selected.</h3>
            <p>You can still write general instructions for your agent.</p>
            <Button variant="link" onClick={() => setTab("general")}>
              Add general instructions
            </Button>
          </div>
        )}
      </div>
      {comments.length > commentLimit && (
        <Button
          variant="link"
          onClick={() => setCommentLimit(commentLimit + 100)}
        >
          Show more comments
        </Button>
      )}
      <footer className="feedback-panel-footer">
        <span>
          {feedback.storageAvailable
            ? workspace.cycle
              ? feedback.saveStatus
              : "Autosaved in this browser"
            : "Available for this session only"}
        </span>
        <Button variant="secondary" onClick={buildPrompt}>
          Build prompt
          <Icon name="arrow" />
        </Button>
      </footer>
    </div>
  );
}
