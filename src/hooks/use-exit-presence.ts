import { useLayoutEffect, useState, type RefObject } from "react";

/** Keep a surface mounted through its CSS exit, with cancelable, bounded cleanup. */
export function useExitPresence<T extends HTMLElement>(
  open: boolean,
  ref: RefObject<T | null>,
) {
  const [retained, setRetained] = useState(open);

  useLayoutEffect(() => {
    if (open) {
      setRetained(true);
      return;
    }
    if (!retained) return;
    const animations = matchMedia("(prefers-reduced-motion: reduce)").matches
      ? []
      : (ref.current?.getAnimations?.() ?? []);
    if (!animations.length) {
      setRetained(false);
      return;
    }
    let canceled = false;
    const finish = () => {
      if (!canceled) setRetained(false);
    };
    // Exits take 140ms. Never hold a modal for a paused/stuck animation.
    const deadline = window.setTimeout(finish, 300);
    void Promise.allSettled(
      animations.map((animation) => animation.finished),
    ).then(finish);
    return () => {
      canceled = true;
      window.clearTimeout(deadline);
    };
  }, [open, retained, ref]);

  return { present: open || retained, exiting: !open && retained };
}
