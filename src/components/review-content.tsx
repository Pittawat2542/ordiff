import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../icons";
import { DiffView } from "../diff-view";
import type { ReviewController } from "../hooks/use-review";
import type { ReviewAction, ReviewSection, FeedbackAnchor } from "../types";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

export function ReviewContent({
  review,
  detailsOpen,
  setDetailsOpen,
  expanded,
  toggleContext,
  openRepository,
  restart,
  addComment,
  buildPrompt,
  revealAnchor,
}: {
  review: ReviewController;
  detailsOpen: boolean;
  setDetailsOpen: (value: boolean) => void;
  expanded: Set<string>;
  toggleContext: (id: string) => void;
  openRepository: () => void;
  restart: () => void;
  addComment: (scope: "file" | "section", anchor?: FeedbackAnchor) => void;
  buildPrompt: () => void;
  revealAnchor?: FeedbackAnchor | null;
}) {
  const { workspace, model, state, mode } = review;
  const visible = model.getVisibleSections(state);
  const active =
    visible.find((section) => section.id === state.activeId) || visible[0];
  const activeId = active?.id;
  const toggleActiveContext = useCallback(() => {
    if (activeId) toggleContext(activeId);
  }, [activeId, toggleContext]);
  const group = model.groupById[state.groupId || ""];
  const guided = state.view === "behavior" && !state.query.trim() && !!group;
  const status = model.getReviewStatus(state);
  const finished =
    status === "clean" || (status === "complete" && !state.revisit);
  const finishedHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (finished) finishedHeading.current?.focus();
  }, [finished]);
  if (!workspace) return null;
  if (finished) {
    const progress = model.getProgress(state),
      complete = status === "complete";
    return (
      <section className="finished-state">
        <span className="finished-emblem">
          <Icon name="check" />
        </span>
        <p className="eyebrow">
          {complete ? "A CLEAR REVIEW QUEUE" : "YOU’RE UP TO DATE"}
        </p>
        <h1 ref={finishedHeading} tabIndex={-1}>
          {complete ? "All changes reviewed." : "No changes to review."}
        </h1>
        <p>
          {complete
            ? `${progress.total} sections across ${new Set(model.sections.map((section) => section.path)).size} files, considered one at a time.`
            : "There are no changes in this comparison."}
        </p>
        {complete && (
          <span className="completion-caption">
            Your review progress is saved.{" "}
            {
              review.feedback.state.comments.filter(
                (c) => c.text.trim() && c.status !== "resolved",
              ).length
            }{" "}
            feedback items unresolved. Turn your feedback into the next
            iteration.
          </span>
        )}
        <div className="finished-actions">
          <Button onClick={buildPrompt}>
            Build prompt
            <Icon name="arrow" />
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              complete ? review.browse(true) : void review.refreshDiff()
            }
          >
            {complete ? "View reviewed changes" : "Refresh diff"}
            <Icon name={complete ? "arrow" : "retry"} />
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              complete ? void review.refreshDiff() : openRepository()
            }
          >
            {complete ? "Refresh diff" : "Open another repository"}
          </Button>
        </div>
        {complete && (
          <Button variant="link" onClick={restart}>
            Start this review again
          </Button>
        )}
      </section>
    );
  }
  const title = state.query.trim()
    ? "Search changes"
    : guided
      ? group.title
      : state.view === "ungrouped"
        ? "Ungrouped changes"
        : "All changes";
  const explanation =
    active && guided
      ? group.explanations?.[active.id] || active.explanation
      : "";
  return (
    <>
      <section className="content-header">
        <div className="content-title-row">
          <div>
            <p className="eyebrow">
              {state.query.trim()
                ? "SEARCH RESULTS"
                : guided
                  ? "BEHAVIOR REVIEW"
                  : "WORKING CHANGES"}
            </p>
            <h1>{title}</h1>
          </div>
          <span className="scope-caption">
            {guided
              ? `${group.sections.length} steps`
              : `${visible.length} sections`}
          </span>
        </div>
        {guided && (
          <details
            className="agent-context"
            key={`${workspace.version}:${activeId}`}
          >
            <summary>
              <Icon name="sparkle" />
              <span>Explanation</span>
              <Icon name="down" />
            </summary>
            <div className="context-body">
              <span className="agent-badge">
                {mode === "demo" ? "Sample path" : "Agent-proposed"}
              </span>
              <p>{group.description}</p>
              {explanation && (
                <div className="step-explanation">
                  <strong>Why this section</strong>
                  <p>{explanation}</p>
                </div>
              )}
            </div>
          </details>
        )}
      </section>
      {workspace.planStatus === "stale" && (
        <div className="plan-notice">
          <Icon name="sparkle" />
          <span>
            Needs updating · The diff changed. Organize behaviors or ask your
            agent for a new review path.
          </span>
        </div>
      )}
      {state.view === "since" && workspace.cycle?.changes.removed.length ? (
        <details className="plan-notice">
          <summary>
            {workspace.cycle.changes.removed.length} removed sections
          </summary>
          {workspace.cycle.changes.removed.map((s) => (
            <p key={s.id}>
              {s.path} · {s.symbol}
            </p>
          ))}
        </details>
      ) : null}
      {active &&
        workspace.cycle?.changes.matches[active.id]?.kind === "unchanged" &&
        workspace.cycle.previousDecisions[
          workspace.cycle.changes.matches[active.id].previousId
        ]?.status === "reviewed" && (
          <p className="plan-notice">
            Previously reviewed · Reconfirm for this pass
          </p>
        )}
      {active ? (
        <div className="active-change">
          <DiffView
            section={active}
            version={workspace.version}
            expanded={expanded.has(active.id)}
            onToggleContext={toggleActiveContext}
            onAddComment={addComment}
            query={state.query}
            comments={review.feedback.state.comments}
            revealAnchor={revealAnchor}
          />
          <ReviewNotes
            review={review}
            section={active}
            open={detailsOpen}
            setOpen={setDetailsOpen}
          />
        </div>
      ) : (
        <div className="empty-state">
          <Icon name="search" />
          <h2>
            {state.filter === "unreviewed" && !state.query
              ? "Nothing left in this view."
              : "No matching changes."}
          </h2>
          <p>
            {state.filter === "unreviewed" && !state.query
              ? "Other behaviors may still need a look."
              : "Try another filename or a line of code."}
          </p>
          <Button variant="secondary" onClick={review.clearFilters}>
            Show all changes
          </Button>
        </div>
      )}
    </>
  );
}
function ReviewNotes({
  review,
  section,
  open,
  setOpen,
}: {
  review: ReviewController;
  section: ReviewSection;
  open: boolean;
  setOpen: (value: boolean) => void;
}) {
  const { state } = review;
  const checked = state.checks[section.id] || [];
  return (
    <details
      className="review-details"

      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <Icon name="note" />
        <span>
          {section.checklist.length ? "Notes & checklist" : "Review note"}
        </span>
        {review.feedback.state.comments.some(
          (comment) =>
            comment.section?.id === section.id && comment.text.trim(),
        ) && <span className="note-dot" aria-label="Has a note" />}
        <Icon name="down" />
      </summary>
      <div className="details-body">
        {section.checklist.length > 0 && (
          <div className="detail-checklist">
            {section.checklist.map((label, index) => (
              <label className="checklist-item" key={`${section.id}-${index}`}>
                <input
                  type="checkbox"
                  checked={checked.includes(index)}
                  onChange={() =>
                    review.dispatch({ type: "check", id: section.id, index })
                  }
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        )}
        <div className="detail-note">
          <label htmlFor="review-note">Your note</label>
          <Textarea
            id="review-note"
            maxLength={2000}
            rows={3}
            aria-label="Review note"
            placeholder="Something to come back to…"
            value={
              review.feedback.state.comments.find(
                (comment) => comment.id === `legacy-${section.id}`,
              )?.text || ""
            }
            onChange={(event) => {
              review.feedback.setQuickNote(section, event.target.value);
            }}
          />
          <span className="note-save-label">
            {review.storageAvailable
              ? review.workspace?.cycle
                ? review.feedback.saveStatus
                : "Saved in this browser for the sample."
              : "Available for this session only."}
          </span>
        </div>
      </div>
    </details>
  );
}

export function ReviewFooter({
  review,
  navigate,
  onContinue,
}: {
  review: ReviewController;
  navigate: (action: ReviewAction) => void;
  onContinue: () => void;
}) {
  const [deferNote, setDeferNote] = useState("");
  const { model, state } = review;
  const status = model.getReviewStatus(state),
    visible = model.getVisibleSections(state);
  if (
    !review.workspace ||
    !visible.length ||
    status === "clean" ||
    (status === "complete" && !state.revisit)
  )
    return null;
  const section = model.getActiveSection(state);
  if (!section) return null;
  const guided =
    state.view === "behavior" && !state.query.trim() && !!model.groups.length;
  const order = guided
    ? model.guidedOrder
    : visible.map((section) => section.id);
  const index = order.indexOf(state.activeId || "");
  const localIndex = visible.findIndex(
    (section) => section.id === state.activeId,
  );
  const reviewed = state.reviewed.includes(section.id);
  return (
    <footer className="review-footer" aria-label="Review controls">
      <div className="footer-location">
        <span className={`review-state ${reviewed ? "is-reviewed" : ""}`}>
          {reviewed ? <Icon name="check" /> : <span className="pending-dot" />}
        </span>
        <span>
          <strong>
            {guided
              ? `Step ${localIndex + 1} of ${visible.length}`
              : `${localIndex + 1} of ${visible.length} sections`}
          </strong>
          <span>
            {reviewed
              ? "Reviewed"
              : state.deferred?.includes(section.id)
                ? "Deferred"
                : "Needs review"}
          </span>
        </span>
      </div>
      <div className="footer-controls">
        <details className="defer-note">
          <summary>Defer note</summary>
          <Textarea
            aria-label="Reason to revisit"
            value={deferNote}
            onChange={(e) => setDeferNote(e.target.value)}
            maxLength={2000}
          />
        </details>
        <Button
          variant="link"
          onClick={() => {
            review.deferAndContinue(deferNote);
            setDeferNote("");
          }}
        >
          Defer & next <kbd>D</kbd>
        </Button>
        {reviewed && (
          <Button
            variant="link"
            className="unreview-button"
            onClick={() =>
              review.dispatch({
                type: "set-reviewed",
                id: section.id,
                reviewed: false,
              })
            }
          >
            Mark unreviewed
          </Button>
        )}
        <div className="step-controls">
          <Button
            variant="ghost"
            aria-label="Previous step"
            title="Previous section (K)"
            disabled={index <= 0}
            onClick={() => navigate({ type: "previous" })}
          >
            <Icon name="left" />
          </Button>
          <Button
            variant="ghost"
            aria-label="Next step"
            title="Next section (J)"
            disabled={index >= order.length - 1}
            onClick={() => navigate({ type: "next" })}
          >
            <Icon name="chevron" />
          </Button>
        </div>
        <Button className="review-primary" onClick={onContinue}>
          <Icon name={reviewed ? "arrow" : "check"} />
          <span>{reviewed ? "Continue" : "Mark reviewed & next"}</span>
          <kbd>R</kbd>
        </Button>
      </div>
    </footer>
  );
}
