import { useCallback, useEffect, useRef, useState } from "react";
import { useReview } from "./hooks/use-review";
import { Icon } from "./icons";
import { Sidebar } from "./components/sidebar";
import { ReviewContent, ReviewDock } from "./components/review-content";
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
    () => matchMedia("(max-width: 760px)").matches,
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
  const { workspace, state, model } = review;
  useEffect(() => {
    const media = matchMedia("(max-width: 760px)");
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
  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k" &&
        workspace
      ) {
        event.preventDefault();
        const isMobile = matchMedia("(max-width: 760px)").matches;
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
        review.markAndContinue();
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
    />
  );
  return (
    <>
      <a className="skip-link" href="#review-content">
        Skip to changes
      </a>
      <div
        className={`app-shell ${workspace ? "" : "onboarding-mode"}`}
        id="app-shell"
      >
        {!mobile && sidebar}
        <main className="workspace" id="workspace">
          <header className="toolbar">
            <div className="toolbar-location">
              <Button
                variant="ghost"
                className="mobile-only"
                id="open-nav"
                aria-label="Open navigation"
                aria-controls="navigation-dialog"
                aria-expanded={navOpen}
                hidden={!workspace}
                onClick={() => setNavOpen(true)}
              >
                <Icon name="menu" />
              </Button>
              <span className="toolbar-repo" id="toolbar-name">
                {workspace?.repo.name || "Ordiff"}
              </span>
              <span className="toolbar-slash">/</span>
              <span id="toolbar-context">
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
                    id="mcp-button"
                    onClick={() => openDialog("mcp")}
                  >
                    <span id="mcp-icon">
                      <Icon name="sparkle" />
                    </span>
                    <span id="mcp-label">
                      {workspace.planStatus === "current"
                        ? "Review path ready"
                        : "Connect agent"}
                    </span>
                  </Button>
                  <Button
                    variant="ghost"
                    className={review.busy ? "is-refreshing" : ""}
                    id="refresh-button"
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
                id="theme-button"
                aria-label={`Switch to ${review.theme === "light" ? "dark" : "light"} appearance`}
                title="Switch appearance"
                onClick={review.toggleTheme}
              >
                <Icon name={review.theme === "light" ? "moon" : "sun"} />
              </Button>
              <Button
                variant="ghost"
                id="help-button"
                aria-label="Help and keyboard shortcuts"
                title="Help (?)"
                onClick={() => openDialog("help")}
              >
                <Icon name="keyboard" />
              </Button>
            </div>
          </header>
          <div className="review-scroll" id="review-scroll" ref={scrollRef}>
            <div id="review-content" tabIndex={-1}>
              {workspace ? (
                <ReviewContent
                  review={review}
                  navigate={navigate}
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
          <div id="review-dock">
            <ReviewDock review={review} navigate={navigate} />
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
        <div id="drawer-slot">{mobile && sidebar}</div>
      </NativeDialog>
      <AppDialog
        kind={dialog}
        close={() => setDialog(null)}
        review={review}
        openRepository={() => openDialog("repository")}
        navigate={navigate}
      />
      <div
        className={`toast ${review.toast ? "visible" : ""}`}
        id="toast"
        role="status"
        aria-live="polite"
      >
        {review.toast}
      </div>
    </>
  );
}
