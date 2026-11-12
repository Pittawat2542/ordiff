import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useReview } from "./hooks/use-review";
import { Sidebar } from "./components/sidebar";
import { ReviewContent, ReviewFooter } from "./components/review-content";
import {
  AppDialog,
  NativeDialog,
  Onboarding,
  type DialogKind,
} from "./components/dialogs";
import { Button } from "./components/ui/button";
import { FeedbackPanel } from "./components/feedback-panel";
import { PromptBuilder } from "./components/prompt-builder";
import { Toolbar } from "./components/toolbar";
import { FeedbackRail } from "./components/feedback-rail";
import type { ReviewAction } from "./types";

const TextDiff = lazy(() => import("./tools/text-diff"));

export function App() {
  if (/^\/tools\/text-diff\/?$/.test(window.location.pathname)) {
    return (
      <Suspense
        fallback={
          <p className="utility-loading" role="status">
            Opening text diff…
          </p>
        }
      >
        <TextDiff />
      </Suspense>
    );
  }
  return <ReviewWorkspace />;
}

function ReviewWorkspace() {
  const review = useReview();
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [feedbackTab, setFeedbackTab] = useState<"file" | "general">("file");
  const [commentFocusId, setCommentFocusId] = useState<string | null>(null);
  const [wide, setWide] = useState(
    () => matchMedia("(min-width: 1280px)").matches,
  );
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
    const media = matchMedia("(min-width: 1280px)");
    const sync = () => setWide(media.matches);
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    setFeedbackOpen(false);
    setPromptOpen(false);
    setCommentFocusId(null);
    setFeedbackTab("file");
  }, [workspace?.repo.path]);
  function buildPrompt() {
    setOverflowOpen(false);
    setDialog(null);
    setNavOpen(false);
    if (!wide) setFeedbackOpen(false);
    setPromptOpen(true);
  }
  function addComment(scope: "file" | "section") {
    const active = model.getActiveSection(state);
    if (!active) return;
    setCommentFocusId(review.feedback.add(active, scope));
    setFeedbackTab("file");
    setFeedbackOpen(true);
    setDialog(null);
    setNavOpen(false);
  }
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
    setOverflowOpen(false);
    setDialog(null);
    setNavOpen(false);
  }
  function openDialog(kind: DialogKind) {
    setOverflowOpen(false);
    setNavOpen(false);
    setFeedbackOpen(false);
    setPromptOpen(false);
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
      if (overflowOpen) return;
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "k" &&
        workspace &&
        !promptOpen &&
        !(feedbackOpen && !wide) &&
        !dialog
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
        promptOpen ||
        (feedbackOpen && !wide) ||
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
  const feedbackPanel = workspace && (
    <FeedbackPanel
      review={review}
      tab={feedbackTab}
      setTab={setFeedbackTab}
      close={() => {
        setFeedbackOpen(false);
        if (wide)
          document
            .querySelector<HTMLButtonElement>(".feedback-toggle")
            ?.focus();
      }}
      addComment={addComment}
      focusId={commentFocusId}
      buildPrompt={buildPrompt}
    />
  );
  return (
    <>
      <a className="skip-link" href="#review-content">
        Skip to changes
      </a>
      <div
        className={`app-shell ${workspace ? "" : "onboarding-mode"} ${feedbackOpen && wide ? "has-feedback" : ""}`}
      >
        {!mobile && sidebar}
        <main className="workspace">
          <Toolbar
            review={review}
            navOpen={navOpen}
            feedbackOpen={feedbackOpen}
            wide={wide}
            overflowOpen={overflowOpen}
            setOverflowOpen={setOverflowOpen}
            openNavigation={() => {
              setOverflowOpen(false);
              setFeedbackOpen(false);
              setNavOpen(true);
            }}
            toggleFeedback={() => {
              setOverflowOpen(false);
              setDialog(null);
              setNavOpen(false);
              setFeedbackOpen((value) => !value);
            }}
            buildPrompt={buildPrompt}
            openDialog={openDialog}
          />
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
                  addComment={addComment}
                  buildPrompt={buildPrompt}
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
        {wide && (
          <FeedbackRail open={feedbackOpen}>{feedbackPanel}</FeedbackRail>
        )}
      </div>
      {!wide && (
        <NativeDialog
          open={feedbackOpen && !promptOpen}
          onClose={() => setFeedbackOpen(false)}
          label="Review feedback"
          className="feedback-drawer"
          id="feedback-dialog"
        >
          {feedbackPanel}
        </NativeDialog>
      )}
      {workspace && (
        <PromptBuilder
          key={review.feedback.key}
          review={review}
          open={promptOpen}
          close={() => setPromptOpen(false)}
        />
      )}
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
        buildPrompt={buildPrompt}
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
