import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { App } from "../../src/App";
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ revision: 0, workspace: null }), {
          headers: { "content-type": "application/json" },
        }),
    ),
  );
});
async function sample() {
  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: /Try the sample review/ }),
  );
}
test("deferred sections remain unreviewed and can be recovered from their queue", async () => {
  await sample();
  fireEvent.click(screen.getByRole("button", { name: /Defer & next/ }));
  fireEvent.click(screen.getByRole("button", { name: /Needs another look/ }));
  expect(
    screen.getByRole("button", { name: /Mark reviewed & next/ }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: /Review summary: 0 of 10/ }),
  ).toBeInTheDocument();
});
test("resolving feedback excludes it from the default prompt and editing reopens it", async () => {
  await sample();
  fireEvent.click(screen.getByRole("button", { name: "Add file comment" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Comment text" }), {
    target: { value: "Fix this" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "Comment status" }), {
    target: { value: "resolved" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Close feedback" }));
  fireEvent.click(screen.getAllByRole("button", { name: "Build prompt" })[0]);
  const dialog = screen.getByRole("dialog", { name: "Build your next prompt" });
  expect(
    within(dialog).getByRole("textbox", { name: "Prompt preview" }),
  ).not.toHaveValue(expect.stringContaining("Fix this"));
});
test("line comments capture a revision and quoted range", async () => {
  await sample();
  const gutter = screen.getAllByRole("button", {
    name: /Select after line/,
  })[0];
  fireEvent.click(gutter);
  fireEvent.click(
    screen.getByRole("button", { name: "Comment on selected lines" }),
  );
  expect(screen.getByText(/Captured after/)).toBeInTheDocument();
});
test("large sections page their rendered lines while retaining original coordinates", async () => {
  const { DiffView } = await import("../../src/diff-view");
  render(
    <DiffView
      section={{
        id: "large",
        path: "large.txt",
        role: "Code",
        lines: Array.from({ length: 1001 }, (_, i) => ({
          type: "add" as const,
          text: `row ${i + 1}`,
          old: null,
          new: i + 1,
        })),
      }}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "Select after line 1001" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next diff lines" }));
  expect(
    screen.getByRole("button", { name: "Select after line 501" }),
  ).toBeInTheDocument();
});

test("sample review demonstrates previous passes, deferred work and addressed line feedback", async () => {
  await sample();
  fireEvent.click(
    screen.getByRole("button", { name: "Explore a review cycle" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Example review cycle" });
  expect(
    within(dialog).getByText("Pass 1 · Previous snapshot"),
  ).toBeInTheDocument();
  expect(
    within(dialog).getByText("Addressed · Awaiting your verification"),
  ).toBeInTheDocument();
  expect(within(dialog).getByText("Pending plan proposal")).toBeInTheDocument();
});
