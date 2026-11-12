import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { App } from "../../src/App";
import type { Workspace } from "../../src/types";

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
  const view = render(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: /Try the sample review/ }),
  );
  return view;
}
function builder() {
  fireEvent.click(screen.getAllByRole("button", { name: "Build prompt" })[0]);
  return screen.getByRole("dialog", { name: "Build your next prompt" });
}

test("comments autosave, remain separate from review progress, and export in selectable batches", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  await sample();
  fireEvent.click(screen.getByRole("button", { name: "Add file comment" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Comment text" }), {
    target: { value: "Keep the public contract." },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "Comment intent" }), {
    target: { value: "keep" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Close feedback" }));
  expect(
    screen.getByRole("button", { name: /Review summary: 0 of 10/ }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Next step" }));
  fireEvent.click(screen.getByRole("button", { name: "Add section comment" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Comment text" }), {
    target: { value: "Improve the error label." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Close feedback" }));
  const dialog = builder();
  const preview = within(dialog).getByRole("textbox", {
    name: "Prompt preview",
  });
  expect((preview as HTMLTextAreaElement).value).toContain(
    "Keep the public contract.",
  );
  expect((preview as HTMLTextAreaElement).value).toContain(
    "Improve the error label.",
  );
  fireEvent.click(
    within(dialog).getByRole("checkbox", {
      name: /Include pipeline\/serialize.ts/,
    }),
  );
  expect((preview as HTMLTextAreaElement).value).not.toContain(
    "Keep the public contract.",
  );
  expect((preview as HTMLTextAreaElement).value).toContain(
    "Improve the error label.",
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Copy prompt" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
  expect(writeText.mock.calls[0][0]).not.toContain("Keep the public contract.");
  fireEvent.click(
    within(dialog).getByRole("checkbox", { name: /Include ui\/RunStatus.tsx/ }),
  );
  fireEvent.click(
    within(dialog).getByRole("checkbox", {
      name: /Include pipeline\/serialize.ts/,
    }),
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Copy prompt" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
  expect(writeText.mock.calls[1][0]).toContain("Keep the public contract.");
  expect(writeText.mock.calls[1][0]).not.toContain("Improve the error label.");
  expect(dialog).toBeVisible();
});

test("general-only prompts, clipboard recovery, and successive copies preserve the builder", async () => {
  await sample();
  const writeText = vi
    .fn()
    .mockRejectedValueOnce(new Error("Denied"))
    .mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  const dialog = builder();
  expect(
    within(dialog).getByRole("button", { name: "Copy prompt" }),
  ).toBeDisabled();
  fireEvent.change(
    within(dialog).getByRole("textbox", { name: "General instructions" }),
    { target: { value: "Improve empty states." } },
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Copy prompt" }));
  expect(
    await within(dialog).findByRole("button", { name: "Select prompt text" }),
  ).toBeVisible();
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Select prompt text" }),
  );
  const preview = within(dialog).getByRole("textbox", {
    name: "Prompt preview",
  }) as HTMLTextAreaElement;
  expect(preview.selectionEnd).toBe(preview.value.length);
  fireEvent.click(within(dialog).getByRole("button", { name: "Copy prompt" }));
  await waitFor(() =>
    expect(within(dialog).getByRole("status")).toHaveTextContent(
      "Prompt copied",
    ),
  );
  expect(dialog).toBeVisible();
  expect(writeText).toHaveBeenLastCalledWith(
    expect.stringContaining("Improve empty states."),
  );
  fireEvent.click(
    within(dialog).getByRole("checkbox", {
      name: "Include general instructions",
    }),
  );
  expect(
    within(dialog).getByRole("button", { name: "Copy prompt" }),
  ).toBeDisabled();
});

test("feedback and legacy imports survive reopening and deletion does not reimport notes", async () => {
  localStorage.setItem(
    "ordiff.review.v2.demo",
    JSON.stringify({
      version: "pipeline-demo-v1",
      notes: { "status-pipeline": "Saved legacy feedback." },
    }),
  );
  const view = await sample();
  let dialog = builder();
  expect(
    (
      within(dialog).getByRole("textbox", {
        name: "Prompt preview",
      }) as HTMLTextAreaElement
    ).value,
  ).toContain("Saved legacy feedback.");
  fireEvent.click(within(dialog).getByText("Edit feedback"));
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Delete comment" }),
  );
  view.unmount();
  await sample();
  dialog = builder();
  expect(
    within(dialog).getByRole("button", { name: "Copy prompt" }),
  ).toBeDisabled();
  expect(
    JSON.parse(localStorage.getItem("ordiff.review.v2.demo")!).notes[
      "status-pipeline"
    ],
  ).toBe("Saved legacy feedback.");
});

const repo: Workspace = {
  version: "v1",
  repo: {
    path: "/tmp/project",
    name: "project",
    branch: "main",
    source: "git",
  },
  groups: [],
  planStatus: "none",
  sections: [
    {
      id: "first",
      path: "run.ts",
      role: "Code",
      symbol: "@@ -1 +1 @@ run",
      lines: [{ type: "add", old: null, new: 1, text: "new code" }],
    },
    { id: "second", path: "other.ts", role: "Code", lines: [] },
  ],
};
function serve(workspace: Workspace) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ revision: 1, workspace }), {
          headers: { "content-type": "application/json" },
        }),
    ),
  );
}

test("refresh keeps feedback, resets review progress, and requires explicit reassignment", async () => {
  serve(repo);
  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Add section comment" }),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Comment text" }), {
    target: { value: "Handle cancellation." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Close feedback" }));
  fireEvent.click(screen.getByRole("button", { name: /Mark reviewed & next/ }));
  const next = {
    ...repo,
    version: "v2",
    sections: [{ ...repo.sections[0], id: "replacement" }, repo.sections[1]],
  };
  serve(next);
  fireEvent.click(screen.getByRole("button", { name: "Refresh diff" }));
  await screen.findByRole("region", { name: "run.ts code diff" });
  expect(
    screen.getByRole("button", { name: /Review summary: 0 of 2/ }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Feedback: 1 comment" }));
  const panel = screen.getByRole("dialog", { name: "Review feedback" });
  expect(within(panel).getByText("Reference needs rechecking")).toBeVisible();
  expect(
    within(panel).getByRole("textbox", { name: "Comment text" }),
  ).toHaveValue("Handle cancellation.");
  fireEvent.click(
    within(panel).getByRole("button", { name: "Reassign to current section" }),
  );
  expect(
    within(panel).queryByText("Reference needs rechecking"),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close feedback" }));
  serve({ ...next, version: "v3", sections: [] });
  fireEvent.click(screen.getByRole("button", { name: "Refresh diff" }));
  await screen.findByText("No changes to review.");
  const dialog = builder();
  expect(
    (
      within(dialog).getByRole("textbox", {
        name: "Prompt preview",
      }) as HTMLTextAreaElement
    ).value,
  ).toContain("no longer in the current diff");
  fireEvent.click(within(dialog).getByText("Edit feedback"));
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Make file comment" }),
  );
  expect(within(dialog).getByText("Whole file")).toBeVisible();
});

test("new feedback is restored after reload and isolated between repositories", async () => {
  serve(repo);
  let view = render(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Add file comment" }),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Comment text" }), {
    target: { value: "Keep this name." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Close feedback" }));
  let dialog = builder();
  fireEvent.change(
    within(dialog).getByRole("textbox", { name: "General instructions" }),
    { target: { value: "Run the unit tests." } },
  );
  view.unmount();
  serve({
    ...repo,
    repo: { ...repo.repo, path: "/tmp/another", name: "another" },
  });
  view = render(<App />);
  await screen.findByRole("button", { name: "Add file comment" });
  dialog = builder();
  expect(
    within(dialog).getByRole("textbox", { name: "General instructions" }),
  ).toHaveValue("");
  expect(
    within(dialog).getByRole("button", { name: "Copy prompt" }),
  ).toBeDisabled();
  view.unmount();
  serve(repo);
  render(<App />);
  await screen.findByRole("button", { name: "Add file comment" });
  dialog = builder();
  const text = (
    within(dialog).getByRole("textbox", {
      name: "Prompt preview",
    }) as HTMLTextAreaElement
  ).value;
  expect(text).toContain("Keep this name.");
  expect(text).toContain("Run the unit tests.");
});

test("Markdown download contains the selected prompt and does not close the builder", async () => {
  await sample();
  const create = vi.fn((_blob: Blob) => "blob:feedback");
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: create,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  const dialog = builder();
  fireEvent.change(
    within(dialog).getByRole("textbox", { name: "General instructions" }),
    { target: { value: "Check the loading state." } },
  );
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Download Markdown" }),
  );
  const blob = create.mock.calls[0][0] as Blob;
  const text = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });
  expect(text).toContain("Check the loading state.");
  expect(text).not.toContain("## File:");
  expect(blob.type).toBe("text/markdown;charset=utf-8");
  expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe(
    "data-platform-review-feedback.md",
  );
  expect(dialog).toBeVisible();
});

test("resetting review progress preserves feedback for the next prompt", async () => {
  serve({ ...repo, sections: [repo.sections[0]] });
  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Add file comment" }),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Comment text" }), {
    target: { value: "Keep the new API." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Close feedback" }));
  fireEvent.click(screen.getByRole("button", { name: /Mark reviewed & next/ }));
  fireEvent.click(
    screen.getByRole("button", { name: "Start this review again" }),
  );
  expect(
    screen.getByRole("button", { name: /Review summary: 0 of 1/ }),
  ).toBeInTheDocument();
  const dialog = builder();
  expect(
    (
      within(dialog).getByRole("textbox", {
        name: "Prompt preview",
      }) as HTMLTextAreaElement
    ).value,
  ).toContain("Keep the new API.");
});

test("unavailable browser storage keeps feedback usable in the current session", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Quota exceeded");
  });
  await sample();
  fireEvent.click(screen.getByRole("button", { name: "Add file comment" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Comment text" }), {
    target: { value: "Still available to copy." },
  });
  expect(screen.getByText("Available for this session only")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Close feedback" }));
  const dialog = builder();
  expect(
    (
      within(dialog).getByRole("textbox", {
        name: "Prompt preview",
      }) as HTMLTextAreaElement
    ).value,
  ).toContain("Still available to copy.");
});
