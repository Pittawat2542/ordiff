import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useState } from "react";
import { NativeDialog } from "../../src/components/dialogs";

// jsdom has no CSS animation engine; only its animation-completion boundary is supplied.
function pendingExit(element: HTMLElement) {
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  Object.defineProperty(element, "getAnimations", {
    value: () => [{ finished }],
  });
  return () =>
    act(async () => {
      finish();
      await finished;
    });
}

function Dialog({ open }: { open: boolean }) {
  return (
    <NativeDialog open={open} onClose={() => {}} label="Review settings">
      <p>Review settings content</p>
    </NativeDialog>
  );
}

afterEach(() => vi.useRealTimers());

test("a closing dialog keeps its content and modality until the exit settles", async () => {
  const view = render(<Dialog open />);
  const dialog = screen.getByRole("dialog", { name: "Review settings" });
  const finish = pendingExit(dialog);
  view.rerender(<Dialog open={false} />);
  expect(dialog).toHaveAttribute("open");
  expect(screen.getByText("Review settings content")).toBeVisible();
  await finish();
  await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
});

test("reopening cancels an unfinished exit instead of closing the new dialog", async () => {
  const view = render(<Dialog open />);
  const dialog = screen.getByRole("dialog", { name: "Review settings" });
  const finish = pendingExit(dialog);
  view.rerender(<Dialog open={false} />);
  expect(dialog).toHaveAttribute("open");
  view.rerender(<Dialog open />);
  await finish();
  expect(dialog).toHaveAttribute("open");
  expect(screen.getByText("Review settings content")).toBeVisible();
});

test("reduced motion dismisses immediately even if an animation is pending", () => {
  const original = window.matchMedia;
  vi.stubGlobal("matchMedia", (query: string) => ({
    ...original(query),
    matches: query === "(prefers-reduced-motion: reduce)",
  }));
  const view = render(<Dialog open />);
  const dialog = screen.getByRole("dialog", { name: "Review settings" });
  pendingExit(dialog);
  view.rerender(<Dialog open={false} />);
  expect(dialog).not.toHaveAttribute("open");
});

test("Escape close requests use the same exit lifecycle as a close button", async () => {
  function Settings() {
    const [open, setOpen] = useState(true);
    return (
      <NativeDialog
        open={open}
        onClose={() => setOpen(false)}
        label="Review settings"
      >
        <button onClick={() => setOpen(false)}>Close settings</button>
      </NativeDialog>
    );
  }
  render(<Settings />);
  const dialog = screen.getByRole("dialog", { name: "Review settings" });
  const finish = pendingExit(dialog);
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(dialog).toHaveAttribute("open");
  await finish();
  await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
});

test("an animation that never settles cannot trap the dialog", () => {
  vi.useFakeTimers();
  const view = render(<Dialog open />);
  const dialog = screen.getByRole("dialog", { name: "Review settings" });
  pendingExit(dialog);
  view.rerender(<Dialog open={false} />);
  expect(dialog).toHaveAttribute("open");
  act(() => vi.advanceTimersByTime(301));
  expect(dialog).not.toHaveAttribute("open");
});
