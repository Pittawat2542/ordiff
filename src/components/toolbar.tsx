import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ReviewController } from "../hooks/use-review";
import { useExitPresence } from "../hooks/use-exit-presence";
import { Icon } from "../icons";
import { Brand } from "./brand";
import { Button } from "./ui/button";
import type { DialogKind } from "./dialogs";

export function Toolbar({
  review,
  navOpen,
  feedbackOpen,
  wide,
  overflowOpen,
  setOverflowOpen,
  openNavigation,
  toggleFeedback,
  buildPrompt,
  openDialog,
}: {
  review: ReviewController;
  navOpen: boolean;
  feedbackOpen: boolean;
  wide: boolean;
  overflowOpen: boolean;
  setOverflowOpen: (open: boolean) => void;
  openNavigation: () => void;
  toggleFeedback: () => void;
  buildPrompt: () => void;
  openDialog: (kind: DialogKind) => void;
}) {
  const { workspace, theme } = review;
  const headerRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const popoverId = useId();
  const { present: popoverPresent, exiting: popoverExiting } = useExitPresence(
    compact && overflowOpen,
    popoverRef,
  );

  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const measure = (width: number) => {
      if (width > 0) setCompact(width < 720);
    };
    measure(header.getBoundingClientRect().width);
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(([entry]) =>
        measure(
          entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width,
        ),
      );
      observer.observe(header);
      return () => observer.disconnect();
    }
    const resize = () => measure(header.getBoundingClientRect().width);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  function dismiss() {
    setOverflowOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }

  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!popover) return;
    function position() {
      if (!popover || !triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      popover.style.top = `${rect.bottom + 8}px`;
      popover.style.right = `${Math.max(12, window.innerWidth - rect.right)}px`;
      popover.style.maxHeight = `${Math.max(120, window.innerHeight - rect.bottom - 24)}px`;
    }
    if (overflowOpen) position();
    if (typeof popover.showPopover === "function") {
      if (overflowOpen && !popover.matches(":popover-open"))
        popover.showPopover();
      else if (!popoverPresent && popover.matches(":popover-open"))
        popover.hidePopover();
    }
    if (overflowOpen) {
      popover
        .querySelector<HTMLButtonElement>("button:not(:disabled)")
        ?.focus();
      window.addEventListener("resize", position);
      return () => window.removeEventListener("resize", position);
    }
  }, [overflowOpen, popoverPresent]);

  useEffect(() => {
    if (!compact && overflowOpen) {
      setOverflowOpen(false);
      headerRef.current
        ?.querySelector<HTMLButtonElement>(".toolbar-utilities button")
        ?.focus();
    }
  }, [compact, overflowOpen, setOverflowOpen]);

  useEffect(() => {
    if (!overflowOpen) return;
    function pointer(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !popoverRef.current?.contains(event.target) &&
        !triggerRef.current?.contains(event.target)
      )
        setOverflowOpen(false);
    }
    function keyboard(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOverflowOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", keyboard, true);
    return () => {
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("keydown", keyboard, true);
    };
  }, [overflowOpen, setOverflowOpen]);

  const utilities = [
    ...(workspace
      ? [
          {
            label:
              workspace.planStatus === "current"
                ? "Review path ready"
                : "Connect agent",
            icon: "sparkle",
            action: () => openDialog("mcp"),
          },
          {
            label: "Refresh diff",
            icon: "retry",
            action: () => void review.refreshDiff(),
            disabled: review.busy,
            spinning: review.busy,
          },
        ]
      : []),
    {
      label: `Switch to ${theme === "light" ? "dark" : "light"} appearance`,
      icon: theme === "light" ? "moon" : "sun",
      action: review.toggleTheme,
    },
    {
      label: "Help and keyboard shortcuts",
      icon: "keyboard",
      action: () => openDialog("help"),
    },
  ];
  const actions = utilities.map((item) => (
    <Button
      key={
        item.icon === "moon" || item.icon === "sun" ? "appearance" : item.icon
      }
      variant={compact ? "unstyled" : "ghost"}
      className={`${compact ? "toolbar-menu-action" : ""} ${item.spinning ? "is-refreshing" : ""}`}
      aria-label={item.label}
      title={item.label}
      disabled={item.disabled}
      onClick={() => {
        if (compact) dismiss();
        item.action();
      }}
    >
      <Icon name={item.icon} />
      {compact && <span>{item.label}</span>}
    </Button>
  ));

  return (
    <header
      className={`toolbar ${compact ? "toolbar-compact" : ""}`}
      ref={headerRef}
    >
      <div className="toolbar-location">
        {workspace && (
          <Button
            variant="ghost"
            className="mobile-only"
            aria-label="Open navigation"
            aria-controls="navigation-dialog"
            aria-expanded={navOpen}
            onClick={openNavigation}
          >
            <Icon name="menu" />
          </Button>
        )}
        <Brand
          wordmark={!workspace}
          className={workspace ? "toolbar-brand mobile-only" : "toolbar-brand"}
        />
        {workspace && (
          <span className="toolbar-repo" title={workspace.repo.name}>
            {workspace.repo.name}
          </span>
        )}
        <span className="toolbar-slash">/</span>
        <span className="toolbar-context">
          {review.mode === "demo"
            ? "Sample review"
            : workspace?.repo.branch || "A clearer way to review"}
        </span>
      </div>
      <div className="toolbar-actions">
        {workspace && (
          <div className="toolbar-primary-actions">
            <Button
              variant="secondary"
              className="feedback-toggle"
              aria-label={`Feedback: ${review.feedback.count} ${review.feedback.count === 1 ? "comment" : "comments"}`}
              aria-expanded={feedbackOpen}
              aria-controls={wide ? "feedback-rail" : "feedback-dialog"}
              onClick={toggleFeedback}
            >
              <Icon name="note" />
              <span>Feedback</span>
              <span className="feedback-count">{review.feedback.count}</span>
            </Button>
            <Button className="build-prompt-button" onClick={buildPrompt}>
              Build prompt
              <Icon name="arrow" />
            </Button>
          </div>
        )}
        {compact ? (
          <div
            className="toolbar-overflow"
            onBlur={(event) => {
              if (
                event.relatedTarget instanceof Node &&
                !event.currentTarget.contains(event.relatedTarget)
              )
                setOverflowOpen(false);
            }}
          >
            <Button
              ref={triggerRef}
              variant="ghost"
              aria-label="More actions"
              title="More actions"
              aria-expanded={overflowOpen}
              aria-controls={popoverId}
              onClick={() => (overflowOpen ? dismiss() : setOverflowOpen(true))}
            >
              <Icon name="more" />
            </Button>
            <div
              ref={popoverRef}
              id={popoverId}
              popover="manual"
              hidden={!popoverPresent}
              aria-hidden={!overflowOpen}
              inert={!overflowOpen}
              data-exiting={popoverExiting ? "" : undefined}
              className="toolbar-popover"
              role="group"
              aria-label="More actions"
            >
              <p className="toolbar-menu-heading">Workspace actions</p>
              {actions}
            </div>
          </div>
        ) : (
          <div className="toolbar-utilities">{actions}</div>
        )}
      </div>
    </header>
  );
}
