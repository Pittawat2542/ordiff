import { Fragment, useCallback, useEffect, useRef } from "react";
import { Icon, roleIcons } from "../icons";
import { DiffView } from "../diff-view";
import type { ReviewController } from "../hooks/use-review";
import type { ReviewAction, ReviewFilter, ReviewSection } from "../types";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

export function ReviewContent({
  review,
  navigate,
  detailsOpen,
  setDetailsOpen,
  expanded,
  toggleContext,
  openRepository,
  restart,
}: {
  review: ReviewController;
  navigate: (action: ReviewAction) => void;
  detailsOpen: boolean;
  setDetailsOpen: (value: boolean) => void;
  expanded: Set<string>;
  toggleContext: (id: string) => void;
  openRepository: () => void;
  restart: () => void;
}) {
  const { workspace, model, state, mode } = review;
  const stepsRef = useRef<HTMLElement>(null);
  const visible = model.getVisibleSections(state);
  const active =
    visible.find((section) => section.id === state.activeId) || visible[0];
  const activeId = active?.id;
  const toggleActiveContext = useCallback(() => {
    if (activeId) toggleContext(activeId);
  }, [activeId, toggleContext]);
  const group = model.groupById[state.groupId || ""];
  const guided =
    state.view === "behavior" && !state.query && !!model.groups.length;
  useEffect(() => {
    const steps = stepsRef.current;
    const step = steps?.querySelector<HTMLElement>(".step.active");
    if (!steps || !step) return;
    const navBounds = steps.getBoundingClientRect(),
      activeBounds = step.getBoundingClientRect();
    if (
      activeBounds.left < navBounds.left ||
      activeBounds.right > navBounds.right
    )
      steps.scrollLeft += activeBounds.left - navBounds.left - 8;
  }, [state.activeId, guided]);
  if (!workspace) return null;
  const status = model.getReviewStatus(state);
  if (status === "clean" || (status === "complete" && !state.revisit)) {
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
        <h1>{complete ? "All changes reviewed." : "No changes to review."}</h1>
        <p>
          {complete
            ? `${progress.total} sections across ${new Set(model.sections.map((section) => section.path)).size} files, considered one at a time.`
            : "This repository has no working changes right now."}
        </p>
        {complete && (
          <span className="completion-caption">
            Your review progress is saved. Your repository is unchanged.
          </span>
        )}
        <div className="finished-actions">
          <Button
            onClick={() =>
              complete ? review.browse(true) : void review.refreshDiff()
            }
          >
            {complete ? "View reviewed changes" : "Refresh diff"}{" "}
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
  const title = state.query
    ? "Search changes"
    : guided
      ? group.title
      : state.view === "ungrouped"
        ? "Ungrouped changes"
        : "All changes";
  const description = state.query
    ? `Results for “${state.query}”`
    : guided
      ? group.description
      : state.view === "ungrouped"
        ? "Changes outside the agent’s reading path. They still count toward your review."
        : `${model.sections.length} sections across ${new Set(model.sections.map((section) => section.path)).size} changed files.`;
  const explanation =
    active && guided
      ? group.explanations?.[active.id] || active.explanation
      : "";
  return (
    <>
      <section className="content-header">
        <div className="content-title-row">
          <h1>{title}</h1>
          {guided && (
            <span className="agent-badge">
              <Icon name="sparkle" />
              {mode === "demo" ? "Sample path" : "Agent-proposed"}
            </span>
          )}
        </div>
        <p className="content-description">{description}</p>
      </section>
      {workspace.planStatus === "stale" && (
        <div className="plan-notice">
          The diff changed. Ask your agent for a new review path.
        </div>
      )}
      {guided ? (
        <nav
          ref={stepsRef}
          className="step-navigation"
          aria-label="Steps in this behavior"
        >
          {group.sections.map((id, index) => {
            const section = model.sectionById[id];
            return (
              <Fragment key={id}>
                {index > 0 && (
                  <span className="step-connector" aria-hidden="true" />
                )}
                <Button
                  variant="unstyled"
                  className={`step ${id === state.activeId ? "active" : ""} ${state.reviewed.includes(id) ? "is-reviewed" : ""}`}
                  aria-current={id === state.activeId ? "step" : undefined}
                  title={section.path}
                  aria-label={`${section.role}: ${section.path}`}
                  onClick={() => navigate({ type: "section", id })}
                >
                  <span className="step-icon">
                    <Icon
                      name={
                        state.reviewed.includes(id)
                          ? "check"
                          : roleIcons[section.role] || "file"
                      }
                    />
                  </span>
                  <span className="step-copy">
                    <span>{section.role}</span>
                    <small>{section.path.split("/").at(-1)}</small>
                  </span>
                  <span className="step-index">{index + 1}</span>
                </Button>
              </Fragment>
            );
          })}
        </nav>
      ) : (
        <div className="list-toolbar">
          <span>
            {visible.length} {visible.length === 1 ? "section" : "sections"}
          </span>
          <label className="status-filter">
            <span>Show</span>
            <select
              id="status-filter"
              aria-label="Filter review status"
              value={state.filter}
              onChange={(event) =>
                review.dispatch({
                  type: "filter",
                  filter: event.target.value as ReviewFilter,
                })
              }
            >
              {[
                ["all", "All changes"],
                ["unreviewed", "Needs review"],
                ["reviewed", "Reviewed"],
              ].map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {active ? (
        <div
          className={`review-layout ${guided ? "guided-layout" : "browse-layout"}`}
        >
          {!guided && (
            <nav className="section-list" aria-label="Changed sections">
              {visible.map((section) => (
                <Button
                  variant="unstyled"
                  key={section.id}
                  className={`section-link ${section.id === active.id ? "selected" : ""}`}
                  aria-current={section.id === active.id ? "true" : undefined}
                  onClick={() => navigate({ type: "section", id: section.id })}
                >
                  <span
                    className={`section-list-icon ${state.reviewed.includes(section.id) ? "done" : ""}`}
                  >
                    <Icon
                      name={
                        state.reviewed.includes(section.id)
                          ? "check"
                          : roleIcons[section.role] || "file"
                      }
                    />
                  </span>
                  <span>
                    <strong>{section.path.split("/").at(-1)}</strong>
                    <span>
                      {section.path.includes("/")
                        ? section.path.slice(0, section.path.lastIndexOf("/"))
                        : section.symbol}
                    </span>
                  </span>
                </Button>
              ))}
            </nav>
          )}
          <div className="active-change">
            {explanation && (
              <div className="step-explanation">
                <Icon name="sparkle" />
                <p>{explanation}</p>
              </div>
            )}
            <DiffView
              section={active}
              expanded={expanded.has(active.id)}
              onToggleContext={toggleActiveContext}
            />
            <ReviewNotes
              review={review}
              section={active}
              open={detailsOpen}
              setOpen={setDetailsOpen}
            />
          </div>
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
      id="review-details"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <Icon name="note" />
        <span>
          {section.checklist.length ? "Notes & checklist" : "Review note"}
        </span>
        {state.notes[section.id] && (
          <span className="note-dot" aria-label="Has a note" />
        )}
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
            value={state.notes[section.id] || ""}
            onChange={(event) =>
              review.dispatch({
                type: "note",
                id: section.id,
                text: event.target.value,
              })
            }
          />
          <span id="note-save-label">
            {review.storageAvailable
              ? "Saved only in this browser."
              : "Available for this session only."}
          </span>
        </div>
      </div>
    </details>
  );
}
export function ReviewDock({
  review,
  navigate,
}: {
  review: ReviewController;
  navigate: (action: ReviewAction) => void;
}) {
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
    state.view === "behavior" && !state.query && !!model.groups.length;
  const order = guided
    ? model.guidedOrder
    : visible.map((section) => section.id);
  const index = order.indexOf(state.activeId || ""),
    localIndex = visible.findIndex((section) => section.id === state.activeId);
  const reviewed = state.reviewed.includes(section.id);
  return (
    <div className="dock glass">
      <div className="dock-location">
        <span>
          <strong>
            {guided
              ? `Step ${localIndex + 1} of ${visible.length}`
              : `${localIndex + 1} of ${visible.length} sections`}
          </strong>
          <span>{section.role}</span>
        </span>
      </div>
      <div className="dock-controls flex items-center gap-[4px]">
        <Button
          variant="ghost"
          aria-label="Previous step"
          disabled={index <= 0}
          onClick={() => navigate({ type: "previous" })}
        >
          <Icon name="left" />
        </Button>
        <Button
          variant="ghost"
          aria-label="Next step"
          disabled={index >= order.length - 1}
          onClick={() => navigate({ type: "next" })}
        >
          <Icon name="chevron" />
        </Button>
        <span className="dock-divider" />
        <Button
          className={reviewed ? "reviewed-button" : ""}
          onClick={review.markAndContinue}
        >
          <Icon name="check" />
          <span>{reviewed ? "Mark unreviewed" : "Mark reviewed & next"}</span>
          <kbd>R</kbd>
        </Button>
      </div>
    </div>
  );
}
