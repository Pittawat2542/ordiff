import type { RefObject } from "react";
import { Icon } from "../icons";
import type { ReviewController } from "../hooks/use-review";
import type { ReviewAction } from "../types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function Sidebar({
  review,
  searchRef,
  navigate,
  openRepository,
  openMcp,
  openSummary,
  closeNavigation,
}: {
  review: ReviewController;
  searchRef: RefObject<HTMLInputElement | null>;
  navigate: (action: ReviewAction) => void;
  openRepository: () => void;
  openMcp: () => void;
  openSummary: () => void;
  closeNavigation: () => void;
}) {
  const { workspace, mode, model, state } = review;
  const progress = model.getProgress(state);
  const remaining = model.sections.filter(
    (section) => !section.group && !state.reviewed.includes(section.id),
  ).length;
  return (
    <aside className="sidebar" id="sidebar" aria-label="Review navigation">
      <div className="brand-row flex items-center justify-between">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path
                d="M10 7v18M22 7v5c0 5-12 3-12 9"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <circle cx="10" cy="7" r="3" fill="currentColor" />
              <circle cx="22" cy="7" r="3" fill="currentColor" />
              <circle cx="10" cy="25" r="3" fill="currentColor" />
            </svg>
          </span>
          <span>Ordiff</span>
        </div>
        <Button
          variant="ghost"
          className="mobile-only"
          id="close-nav"
          aria-label="Close navigation"
          onClick={closeNavigation}
        >
          <Icon name="close" />
        </Button>
      </div>
      <Button
        variant="unstyled"
        className="repository"
        id="repository-button"
        aria-label="Repository settings"
        title={workspace?.repo.path}
        onClick={openRepository}
      >
        <span id="repo-icon">
          <Icon name="repo" />
        </span>
        <span className="repository-copy">
          <strong>{workspace?.repo.name || "No repository"}</strong>
          <span>
            {mode === "demo"
              ? "Sample repository"
              : workspace?.repo.branch || "Open a local repository"}
          </span>
        </span>
        <Icon name="down" />
      </Button>
      <div className="search-wrap">
        <span id="search-icon">
          <Icon name="search" />
        </span>
        <Input
          ref={searchRef}
          id="search"
          type="search"
          aria-label="Search all changes"
          placeholder="Find a change…"
          autoComplete="off"
          value={state.query}
          onChange={(event) =>
            review.dispatch({ type: "search", query: event.target.value })
          }
        />
        <kbd aria-hidden="true">⌘ K</kbd>
      </div>
      <div className="nav-label" hidden={!model.sections.length}>
        <span>REVIEW PATH</span>
        <span id="path-count">{model.groups.length || ""}</span>
      </div>
      <nav id="group-navigation" aria-label="Behaviors">
        {model.sections.length > 0 &&
          (model.groups.length ? (
            model.groups.map((group, index) => {
              const groupProgress = model.getProgress(state, group.id);
              const selected =
                state.view === "behavior" &&
                !state.query &&
                state.groupId === group.id;
              return (
                <Button
                  variant="unstyled"
                  key={group.id}
                  className={`behavior-link ${selected ? "selected" : ""}`}
                  aria-current={selected ? "page" : undefined}
                  onClick={() => navigate({ type: "group", id: group.id })}
                >
                  <span className="behavior-number">
                    {groupProgress.percent === 100 ? (
                      <Icon name="check" />
                    ) : (
                      `0${index + 1}`
                    )}
                  </span>
                  <span className="behavior-link-copy">
                    <strong>{group.short || group.title}</strong>
                    <span>
                      {groupProgress.reviewed} of {groupProgress.total} reviewed
                    </span>
                  </span>
                </Button>
              );
            })
          ) : (
            <div className="no-path">
              <p>No review path yet.</p>
              <Button variant="link" onClick={openMcp}>
                Connect your agent <Icon name="arrow" />
              </Button>
            </div>
          ))}
      </nav>
      <div className="nav-separator" />
      <nav id="other-navigation" aria-label="Complete diff">
        {model.sections.length > 0 && (
          <>
            <Button
              variant="unstyled"
              className={`plain-nav ${state.view === "all" && !state.query ? "selected" : ""}`}
              onClick={() => navigate({ type: "view", view: "all" })}
            >
              <Icon name="files" />
              <span>All changes</span>
              <span className="nav-count">{model.sections.length}</span>
            </Button>
            <Button
              variant="unstyled"
              className={`plain-nav ${state.view === "ungrouped" && !state.query ? "selected" : ""}`}
              onClick={() => navigate({ type: "view", view: "ungrouped" })}
            >
              <Icon name="ungrouped" />
              <span>Ungrouped changes</span>
              <span className="nav-count">{remaining}</span>
            </Button>
          </>
        )}
      </nav>
      <div className="sidebar-bottom">
        <div id="review-progress">
          {model.sections.length ? (
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
          ) : (
            <p className="no-pending">No pending changes</p>
          )}
        </div>
        <div className="local-label">
          <span />
          <span id="source-label">
            {mode === "demo" ? "Sample diff" : "Local working tree"}
          </span>
        </div>
      </div>
    </aside>
  );
}
