import { useEffect, useRef, type RefObject } from "react";
import { Icon } from "../icons";
import type { ReviewController } from "../hooks/use-review";
import type { ReviewAction, ReviewFilter, ReviewSection } from "../types";
import { Button } from "./ui/button";
import { Brand } from "./brand";
import { Input } from "./ui/input";

export function Sidebar({
  review,
  searchRef,
  navigate,
  openRepository,
  openMcp,
  openSummary,
  closeNavigation,
  visible: navigationVisible,
}: {
  review: ReviewController;
  searchRef: RefObject<HTMLInputElement | null>;
  navigate: (action: ReviewAction) => void;
  openRepository: () => void;
  openMcp: () => void;
  openSummary: () => void;
  closeNavigation: () => void;
  visible: boolean;
}) {
  const { workspace, mode, model, state } = review;
  const listRef = useRef<HTMLDivElement>(null);
  const progress = model.getProgress(state);
  const visible = model.getVisibleSections(state);
  const searching = !!state.query.trim();
  const guided = state.view === "behavior" && !searching;
  const ungrouped = model.sections.filter((section) => !section.group);
  const remaining = ungrouped.filter(
    (section) => !state.reviewed.includes(section.id),
  ).length;
  useEffect(() => {
    if (!navigationVisible) return;
    const frame = requestAnimationFrame(() => {
      listRef.current
        ?.querySelector('[aria-current="true"]')
        ?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [
    state.activeId,
    state.view,
    state.query,
    state.filter,
    navigationVisible,
  ]);

  function sectionLink(section: ReviewSection) {
    return (
      <SectionLink
        key={section.id}
        section={section}
        selected={section.id === state.activeId}
        reviewed={state.reviewed.includes(section.id)}
        commentCount={
          review.feedback.state.comments.filter(
            (comment) =>
              comment.text.trim() &&
              comment.path === section.path &&
              (!comment.section || comment.section.id === section.id),
          ).length
        }
        onSelect={() => navigate({ type: "section", id: section.id })}
      />
    );
  }
  return (
    <aside className="sidebar" aria-label="Review navigation">
      <div className="brand-row">
        <Brand wordmark />
        <span className="brand-caption">REVIEW WORKSPACE</span>
        <Button
          variant="ghost"
          className="mobile-only"
          aria-label="Close navigation"
          onClick={closeNavigation}
        >
          <Icon name="close" />
        </Button>
      </div>
      <Button
        variant="unstyled"
        className="repository"

        aria-label="Repository settings"
        title={workspace?.repo.path}
        onClick={openRepository}
      >
        <span className="repository-icon">
          <Icon name="repo" />
        </span>
        <span className="repository-copy">
          <strong>{workspace?.repo.name || "No repository"}</strong>
          <span>
            <Icon name="branch" />
            {mode === "demo" ? "Sample repository" : workspace?.repo.branch}
          </span>
        </span>
        <Icon name="down" />
      </Button>
      <div className="search-wrap">
        <Icon name="search" />
        <Input
          ref={searchRef}

          type="search"
          aria-label="Search all changes"
          placeholder="Find a change…"
          autoComplete="off"
          value={state.query}
          onChange={(event) =>
            review.dispatch({ type: "search", query: event.target.value })
          }
        />
        {searching ? (
          <Button
            variant="ghost"
            aria-label="Clear search"
            onClick={() => review.dispatch({ type: "search", query: "" })}
          >
            <Icon name="close" />
          </Button>
        ) : (
          <kbd aria-hidden="true">⌘ K</kbd>
        )}
      </div>
      <nav className="scope-navigation" aria-label="Review scope">
        <Button
          variant="unstyled"
          className={`plain-nav ${guided ? "selected" : ""}`}
          disabled={!model.groups.length}
          aria-current={guided ? "page" : undefined}
          onClick={() =>
            navigate({ type: "group", id: state.groupId || model.groups[0].id })
          }
        >
          <Icon name="branch" />
          <span>Behaviors</span>
          <span className="nav-count">{model.groups.length}</span>
        </Button>
        <Button
          variant="unstyled"
          className={`plain-nav ${state.view === "all" && !searching ? "selected" : ""}`}
          aria-current={state.view === "all" && !searching ? "page" : undefined}
          onClick={() => navigate({ type: "view", view: "all" })}
        >
          <Icon name="files" />
          <span>All changes</span>
          <span className="nav-count">{model.sections.length}</span>
        </Button>
        <Button
          variant="unstyled"
          className={`plain-nav ${state.view === "ungrouped" && !searching ? "selected" : ""}`}
          aria-current={
            state.view === "ungrouped" && !searching ? "page" : undefined
          }
          onClick={() => navigate({ type: "view", view: "ungrouped" })}
        >
          <Icon name="ungrouped" />
          <span>Ungrouped changes</span>
          <span className="nav-count" title={`${remaining} need review`}>
            {ungrouped.length}
          </span>
        </Button>
        <Button
          variant="unstyled"
          className={`plain-nav ${state.view === "deferred" ? "selected" : ""}`}
          onClick={() => navigate({ type: "view", view: "deferred" })}
        >
          <Icon name="status" />
          <span>Needs another look</span>
          <span className="nav-count">{state.deferred?.length || 0}</span>
        </Button>
        {workspace?.cycle?.history.length &&
        workspace.cycle.history.length > 1 ? (
          <Button
            variant="unstyled"
            className={`plain-nav ${state.view === "since" ? "selected" : ""}`}
            onClick={() => navigate({ type: "view", view: "since" })}
          >
            <Icon name="retry" />
            <span>Since previous pass</span>
          </Button>
        ) : null}
      </nav>
      <details className="cycle-filters">
        <summary>Filter changes</summary>
        <label>
          File
          <select
            value={state.pathFilter || ""}
            onChange={(e) =>
              review.dispatch({ type: "facets", pathFilter: e.target.value })
            }
          >
            <option value="">All files</option>
            {[...new Set(model.sections.map((s) => s.path))].map((path) => (
              <option key={path}>{path}</option>
            ))}
          </select>
        </label>
        <label>
          Changed since previous pass
          <select
            value={state.changeFilter || ""}
            onChange={(e) =>
              review.dispatch({ type: "facets", changeFilter: e.target.value })
            }
          >
            <option value="">All changes</option>
            <option value="added">Added</option>
            <option value="modified">Modified</option>
            <option value="unchanged">Unchanged</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={!!state.feedbackOnly}
            onChange={(e) =>
              review.dispatch({
                type: "facets",
                feedbackOnly: e.target.checked,
              })
            }
          />{" "}
          Has unresolved feedback
        </label>
        <Button variant="link" onClick={review.clearFilters}>
          Clear filters
        </Button>
      </details>
      <div className="navigation-heading">
        <span>
          {searching
            ? "Search results"
            : guided
              ? "Review path"
              : "Changed sections"}
        </span>
        {!guided && <span aria-live="polite">{visible.length}</span>}
      </div>
      {!guided && model.sections.length > 0 && (
        <label className="status-filter">
          <span>Show</span>
          <select
            aria-label="Filter review status"
            value={state.filter}
            onChange={(event) =>
              review.dispatch({
                type: "filter",
                filter: event.target.value as ReviewFilter,
              })
            }
          >
            <option value="all">All changes</option>
            <option value="deferred">Needs another look</option>
            <option value="unreviewed">Needs review</option>
            <option value="reviewed">Reviewed</option>
          </select>
        </label>
      )}
      <div className="navigation-scroll" ref={listRef}>
        {guided ? (
          <nav className="behavior-list" aria-label="Behaviors">
            {model.groups.map((group, index) => {
              const selected = state.groupId === group.id;
              const p = model.getProgress(state, group.id);
              return (
                <div className="behavior-group" key={group.id}>
                  <Button
                    variant="unstyled"
                    className={`behavior-link ${selected ? "selected" : ""}`}
                    aria-expanded={selected}
                    aria-controls={selected ? `group-${group.id}` : undefined}
                    onClick={() => navigate({ type: "group", id: group.id })}
                  >
                    <span className="behavior-number">
                      {p.percent === 100 ? (
                        <Icon name="check" />
                      ) : (
                        String(index + 1).padStart(2, "0")
                      )}
                    </span>
                    <span className="behavior-link-copy">
                      <strong>{group.short || group.title}</strong>
                      <span>
                        {p.reviewed} / {p.total} reviewed
                      </span>
                    </span>
                    <Icon name="chevron" />
                  </Button>
                  {selected && (
                    <nav
                      className="group-sections"
                      id={`group-${group.id}`}
                      aria-label="Steps in this behavior"
                    >
                      {visible.map(sectionLink)}
                    </nav>
                  )}
                </div>
              );
            })}
          </nav>
        ) : (
          <nav className="section-list" aria-label="Changed sections">
            {visible.map(sectionLink)}
          </nav>
        )}
        {!visible.length && (
          <p className="navigation-empty">
            {searching
              ? "No matching sections."
              : model.sections.length
                ? "Nothing in this view."
                : "No pending changes."}
          </p>
        )}
      </div>
      {!model.groups.length && model.sections.length > 0 && (
        <div className="no-path">
          <Icon name="sparkle" />
          <div>
            <p>Want a guided review?</p>
            <Button variant="link" onClick={openMcp}>
              Connect your agent <Icon name="arrow" />
            </Button>
          </div>
        </div>
      )}
      <div className="sidebar-bottom">
        <Button
          variant="unstyled"
          className="simple-progress"
          aria-label={`Review summary: ${progress.reviewed} of ${progress.total} sections reviewed`}
          onClick={openSummary}
        >
          <span>
            <strong>Your review</strong>
            <span>
              {progress.reviewed} / {progress.total}
            </span>
          </span>
          <span className="progress-track">
            <span style={{ width: `${progress.percent}%` }} />
          </span>
        </Button>
        <div className="local-label">
          <Icon name="lock" />
          <span>{mode === "demo" ? "Sample diff" : "Local working tree"}</span>
        </div>
      </div>
    </aside>
  );
}

function SectionLink({
  section,
  selected,
  reviewed,
  onSelect,
  commentCount,
}: {
  section: ReviewSection;
  selected: boolean;
  reviewed: boolean;
  onSelect: () => void;
  commentCount: number;
}) {
  const split = section.path.lastIndexOf("/");
  const symbol = section.symbol || section.title || "Changed section";
  let numbered = section.lines.flatMap((line) =>
    line.new === null ? [] : [line.new],
  );
  if (!numbered.length)
    numbered = section.lines.flatMap((line) =>
      line.old === null ? [] : [line.old],
    );
  const first = numbered[0],
    last = numbered.at(-1);
  const range =
    first === undefined
      ? ""
      : first === last
        ? `L${first}`
        : `L${first}–${last}`;
  return (
    <Button
      variant="unstyled"
      className={`section-link ${selected ? "selected" : ""}`}
      aria-current={selected ? "true" : undefined}
      aria-label={`${section.role}: ${section.path} — ${symbol}`}
      aria-describedby={`section-meta-${section.id}`}
      title={section.path}
      onClick={onSelect}
    >
      <span
        className={`section-list-icon ${reviewed ? "done" : ""}`}
        aria-hidden="true"
      >
        {reviewed ? <Icon name="check" /> : <span className="pending-dot" />}
      </span>
      <span className="section-copy">
        <strong>{section.path.slice(split + 1)}</strong>
        <span className="section-symbol">{symbol}</span>
        <span className="section-meta" id={`section-meta-${section.id}`}>
          <span>{split < 0 ? section.role : section.path.slice(0, split)}</span>
          <span>{range}</span>
          {commentCount > 0 && (
            <span
              className="section-feedback-count"
              aria-label={`${commentCount} ${commentCount === 1 ? "comment" : "comments"}`}
            >
              <Icon name="note" />
              {commentCount}
            </span>
          )}
          <span className="sr-only">
            {reviewed ? "Reviewed" : "Needs review"}
          </span>
        </span>
      </span>
    </Button>
  );
}
