import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { ReviewController } from "../hooks/use-review";
import { Icon } from "../icons";
import { Button } from "./ui/button";
import { RepositoryChooser } from "./repository-chooser";

export function RepositorySwitcher({
  review,
  triggerRef,
  onManage,
}: {
  review: ReviewController;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onManage: () => void;
}) {
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const native = typeof HTMLElement.prototype.showPopover === "function";
  const repo = review.workspace!.repo;
  const unread = new Set([
    ...(review.repositories || [])
      .filter((repo) => repo.unseen)
      .map((repo) => repo.path),
    ...review.importErrors.map((error) => error.path),
  ]).size;
  const activityLabel = unread
    ? `, ${unread} ${unread === 1 ? "repo" : "repos"} with updates`
    : "";

  function close() {
    panelRef.current?.hidePopover?.();
    setOpen(false);
  }
  function returnToTrigger() {
    close();
    triggerRef.current?.focus({ preventScroll: true });
  }

  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (
      !open ||
      !trigger ||
      !panel ||
      (native && window.CSS?.supports("top: anchor(bottom)"))
    )
      return;
    const position = () => {
      const rect = trigger.getBoundingClientRect();
      panel.style.setProperty("--repo-bottom", rect.bottom + "px");
      panel.style.setProperty("--repo-left", rect.left + "px");
    };
    position();
    window.addEventListener("resize", position);
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(position)
        : null;
    observer?.observe(trigger);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", position);
    };
  }, [open, native, triggerRef]);

  useEffect(() => {
    if (!open || native) return;
    function pointer(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !panelRef.current?.contains(event.target) &&
        !triggerRef.current?.contains(event.target)
      )
        setOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus({ preventScroll: true });
      }
    }
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("keydown", escape);
    };
  }, [open, native, triggerRef]);

  return (
    <>
      <Button
        ref={triggerRef}
        variant="unstyled"
        className="toolbar-repo repository-switcher"
        title={repo.path}
        aria-label={`Switch repository: ${repo.name}${activityLabel}`}
        aria-expanded={open}
        aria-controls={id}
        popoverTarget={id}
        onClick={native ? undefined : () => setOpen((value) => !value)}
      >
        <span>{repo.name}</span>
        {unread > 0 && <span className="repo-update-count">{unread}</span>}
        <Icon name="down" />
      </Button>
      {createPortal(
        <div
          ref={panelRef}
          id={id}
          popover="auto"
          hidden={!native && !open}
          className="repository-popover"
          role="group"
          aria-label="Switch repository"
          onToggle={(event) => setOpen(event.newState === "open")}
          onBlur={(event) => {
            if (
              event.relatedTarget instanceof Node &&
              event.relatedTarget !== triggerRef.current &&
              !event.currentTarget.contains(event.relatedTarget)
            )
              close();
          }}
        >
          {open && (
            <RepositoryChooser
              review={review}
              onConnected={returnToTrigger}
              onManage={() => {
                returnToTrigger();
                onManage();
              }}
            />
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
