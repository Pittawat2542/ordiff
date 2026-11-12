import { useRef, type ReactNode } from "react";
import { useExitPresence } from "../hooks/use-exit-presence";

export function FeedbackRail({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  const { present, exiting } = useExitPresence(open, ref);
  if (!present) return null;
  return (
    <aside
      ref={ref}
      className="feedback-rail"
      id="feedback-rail"
      aria-label="Review feedback"
      aria-hidden={!open}
      inert={!open}
      data-exiting={exiting ? "" : undefined}
    >
      {children}
    </aside>
  );
}
