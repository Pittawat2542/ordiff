import { useCallback, useEffect, useRef, useState } from "react";
import { useReview } from "./hooks/use-review";
import { Icon } from "./icons";
import { Sidebar } from "./components/sidebar";
import { ReviewContent, ReviewFooter } from "./components/review-content";
import {
  AppDialog,
  NativeDialog,
  Onboarding,
  type DialogKind,
} from "./components/dialogs";
import { Button } from "./components/ui/button";
import type { ReviewAction } from "./types";

export function App() {
  const review = useReview();
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [mobile, setMobile] = useState(
    () => matchMedia("(max-width: 1023px)").matches,
  );
  const [focusSearch, setFocusSearch] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [expanded, setExpanded] = useState(new Set<string>());
  const toggleContext = useCallback((id: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const focusAfterUndo = useRef(false);
  const { workspace, state, model } = review;
  useEffect(() => {
    if (!focusAfterUndo.current) return;
    focusAfterUndo.current = false;
    const target =
      document.querySelector<HTMLElement>("#active-diff .diff-code") ||
      document.getElementById("review-content");
    target?.focus({ preventScroll: true });
  }, [state, review.canUndo]);
  useEffect(() => {
    const media = matchMedia("(max-width: 1023px)");
    const sync = () => {
      setMobile(media.matches);
      if (!media.matches) setNavOpen(false);
    };
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    setDetailsOpen(false);
    setExpanded(new Set());
  }, [workspace?.repo.path, workspace?.version]);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setDetailsOpen(false);
  }, [state.activeId, state.view, workspace?.version]);
  useEffect(() => {
    if (focusSearch) {
      searchRef.current?.focus();
      setFocusSearch(false);
    }
  }, [focusSearch, navOpen]);
  function closeDialogs() {
    setDialog(null);
    setNavOpen(false);
  }
  function openDialog(kind: DialogKind) {
    setNavOpen(false);
    setDialog(kind);
  }
  function navigate(action: ReviewAction) {
    closeDialogs();
    review.dispatch(action);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }
  function restart() {
    review.restart();
    setDetailsOpen(false);
    setExpanded(new Set());
  }
  function continueReview() {
    if (model.getReviewStatus(state) === "complete") openDialog("summary");
    else review.markAndContinue();
  }
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k" &&
        workspace
      ) {
        event.preventDefault();
        const isMobile = matchMedia("(max-width: 1023px)").matches;
        setDialog(null);
        setMobile(isMobile);
        setNavOpen(isMobile);
        setFocusSearch(true);
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        dialog ||
        navOpen ||
        target?.closest("input, textarea, select, [contenteditable]")
      )
        return;
      if (event.key === "?") {
        event.preventDefault();
        openDialog("help");
      }
      if (
        !workspace ||
        (model.getReviewStatus(state) !== "reviewing" && !state.revisit)
      )
        return;
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        if (!event.repeat) continueReview();
      }
      if (event.key.toLowerCase() === "j") {
        event.preventDefault();
        navigate({ type: "next" });
      }
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        navigate({ type: "previous" });
      }
    }
    document.addEventListener("keydown", keyboard);
    return () => document.removeEventListener("keydown", keyboard);
  });
  const sidebar = workspace && (
    <Sidebar
      review={review}
      searchRef={searchRef}
      navigate={navigate}
      openRepository={() => openDialog("repository")}
      openMcp={() => openDialog("mcp")}
      openSummary={() => openDialog("summary")}
      closeNavigation={() => setNavOpen(false)}
      visible={!mobile || navOpen}
    />
  );
  return (
    <>
      <a className="skip-link" href="#review-content">
        Skip to changes
      </a>
      <div className={`app-shell ${workspace ? "" : "onboarding-mode"}`}>
        {!mobile && sidebar}
        <main className="workspace">
          <header className="toolbar">
            <div className="toolbar-location">
              <Button
                variant="ghost"
                className="mobile-only"

                aria-label="Open navigation"
                aria-controls="navigation-dialog"
                aria-expanded={navOpen}
                hidden={!workspace}
                onClick={() => setNavOpen(true)}
              >
                <Icon name="menu" />
              </Button>
              <span className="toolbar-repo">
                {workspace?.repo.name || "Ordiff"}
              </span>
              <span className="toolbar-slash">/</span>
              <span className="toolbar-context">
                {review.mode === "demo"
                  ? "Sample review"
                  : workspace?.repo.branch || "A clearer way to review"}
              </span>
            </div>
            <div className="toolbar-actions">
              {workspace && (
                <>
                  <Button
                    variant="unstyled"
                    className="mcp-button"

                    onClick={() => openDialog("mcp")}
                  >
                    <span>
                      <Icon name="sparkle" />
                    </span>
                    <span>
                      {workspace.planStatus === "current"
                        ? "Review path ready"
                        : "Connect agent"}
                    </span>
                  </Button>
                  <Button
                    variant="ghost"
                    className={review.busy ? "is-refreshing" : ""}

                    aria-label="Refresh diff"
                    title="Refresh Git changes"
                    disabled={review.busy}
                    onClick={() => void review.refreshDiff()}
                  >
                    <Icon name="retry" />
                  </Button>
                </>
              )}
              <Button
                variant="ghost"

                aria-label={`Switch to ${review.theme === "light" ? "dark" : "light"} appearance`}
                title="Switch appearance"
                onClick={review.toggleTheme}
              >
                <Icon name={review.theme === "light" ? "moon" : "sun"} />
              </Button>
              <Button
                variant="ghost"

                aria-label="Help and keyboard shortcuts"
                title="Help (?)"
                onClick={() => openDialog("help")}
              >
                <Icon name="keyboard" />
              </Button>
            </div>
          </header>
          <div className="review-scroll" ref={scrollRef}>
            <div id="review-content" tabIndex={-1}>
              {workspace ? (
                <ReviewContent
                  review={review}
                  detailsOpen={detailsOpen}
                  setDetailsOpen={setDetailsOpen}
                  expanded={expanded}
                  toggleContext={toggleContext}
                  openRepository={() => openDialog("repository")}
                  restart={restart}
                />
              ) : (
                <Onboarding review={review} />
              )}
            </div>
          </div>
          <div className="review-footer-slot">
            <ReviewFooter
              review={review}
              navigate={navigate}
              onContinue={continueReview}
            />
          </div>
        </main>
      </div>
      <NativeDialog
        id="navigation-dialog"
        className="navigation-dialog"
        open={mobile && navOpen}
        onClose={() => setNavOpen(false)}
        label="Review navigation"
      >
        <div className="navigation-content">{mobile && sidebar}</div>
      </NativeDialog>
      <AppDialog
        kind={dialog}
        close={() => setDialog(null)}
        review={review}
        openRepository={() => openDialog("repository")}
        navigate={navigate}
      />
      <div
        className={`toast ${review.toast || review.canUndo ? "visible" : ""}`}

        role="status"
        aria-live="polite"
      >
        <span>
          {review.toast || (review.canUndo ? "Section reviewed." : "")}
        </span>
        {review.canUndo && (
          <Button
            variant="link"
            onClick={() => {
              focusAfterUndo.current = true;
              review.undoLastMark();
            }}
          >
            Undo
          </Button>
        )}
      </div>
    </>
  );
}
