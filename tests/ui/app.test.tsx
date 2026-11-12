import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { App } from "../../src/App";
import type { Workspace } from "../../src/types";

const repo: Workspace = {
  version: "git-v1",
  repo: {
    name: "real-repo",
    path: "/tmp/real-repo",
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
      language: "TypeScript",
      symbol: "run",
      title: "Run status",
      lines: [
        {
          type: "add",
          old: null,
          new: 1,
          text: 'export const status = "failed";',
        },
      ],
    },
    {
      id: "second",
      path: "README.md",
      role: "Docs",
      language: "Markdown",
      title: "Guide",
      lines: [
        {
          type: "add",
          old: null,
          new: 1,
          text: '<script>alert("hello")</script>',
        },
      ],
    },
  ],
};
const config = {
  mcpServers: {
    ordiff: {
      command: "node",
      args: ["/ordiff/server/mcp.js"],
      env: { ORDIFF_URL: "http://127.0.0.1:5173" },
    },
  },
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  document.documentElement.dataset.theme = "light";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      json({
        revision: 0,
        workspace: null,
        defaultPath: "/tmp/real-repo",
        mcpConfig: config,
      }),
    ),
  );
});
async function sample() {
  const view = render(<App />);
  await waitFor(() =>
    expect(
      screen.getByRole("textbox", { name: "Local repository" }),
    ).toHaveValue("/tmp/real-repo"),
  );
  fireEvent.click(
    screen.getByRole("button", { name: /Try the sample review/ }),
  );
  return view;
}

test("help keeps its contents during exit instead of collapsing to an empty sheet", async () => {
  await sample();
  fireEvent.click(
    screen.getByRole("button", { name: "Help and keyboard shortcuts" }),
  );
  const dialog = screen.getByRole("dialog", { name: "A clearer review." });
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  Object.defineProperty(dialog, "getAnimations", {
    value: () => [{ finished }],
  });
  fireEvent.click(screen.getByRole("button", { name: "Close help" }));
  expect(
    within(dialog).getByRole("heading", { name: "A clearer review." }),
  ).toBeVisible();
  await act(async () => {
    finish();
    await finished;
  });
  await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
});

// ResizeObserver supplies layout measurements that jsdom cannot calculate.
function toolbarWidth(initialWidth: number) {
  let notify: (width: number) => void = () => {};
  let observed: Element = document.body;
  vi.stubGlobal(
    "ResizeObserver",
    class implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        notify = (width) =>
          callback(
            [
              {
                target: observed,
                contentRect: new DOMRect(0, 0, width - 34, 54),
                borderBoxSize: [{ inlineSize: width, blockSize: 56 }],
                contentBoxSize: [{ inlineSize: width - 34, blockSize: 54 }],
                devicePixelContentBoxSize: [
                  { inlineSize: width - 34, blockSize: 54 },
                ],
              },
            ],
            this,
          );
      }
      observe(target: Element) {
        observed = target;
        notify(initialWidth);
      }
      unobserve() {}
      disconnect() {}
    },
  );
  return (width: number) => act(() => notify(width));
}

test("compact toolbar keeps primary actions visible and runs appearance actions from More", async () => {
  toolbarWidth(640);
  await sample();
  expect(screen.getByRole("button", { name: "Build prompt" })).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Feedback: 0 comments" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Switch to dark appearance" }),
  ).not.toBeInTheDocument();
  const more = screen.getByRole("button", { name: "More actions" });
  fireEvent.click(more);
  fireEvent.click(
    screen.getByRole("button", { name: "Switch to dark appearance" }),
  );
  expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  expect(more).toHaveAttribute("aria-expanded", "false");
  expect(more).toHaveFocus();
});

test("toolbar measures the whole workspace rather than subtracting its own padding", async () => {
  toolbarWidth(740);
  await sample();
  expect(
    screen.queryByRole("button", { name: "More actions" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Connect agent" })).toBeVisible();
});

test("More dismisses with Escape and suppresses review shortcuts while open", async () => {
  toolbarWidth(640);
  await sample();
  const more = screen.getByRole("button", { name: "More actions" });
  fireEvent.click(more);
  const refresh = screen.getByRole("button", { name: "Refresh diff" });
  refresh.focus();
  fireEvent.keyDown(refresh, { key: "r" });
  expect(
    screen.getByRole("button", {
      name: "Review summary: 0 of 10 sections reviewed",
    }),
  ).toBeInTheDocument();
  fireEvent.keyDown(refresh, { key: "Escape" });
  expect(more).toHaveAttribute("aria-expanded", "false");
  expect(more).toHaveFocus();
});

test("More opens help and releases its popover before the dialog receives focus", async () => {
  toolbarWidth(640);
  await sample();
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Help and keyboard shortcuts" }),
  );
  expect(
    screen.getByRole("dialog", { name: "A clearer review." }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "More actions" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
});

test("widening the workspace dismisses More and makes its actions available inline", async () => {
  const resize = toolbarWidth(640);
  await sample();
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
  resize(900);
  expect(
    screen.queryByRole("button", { name: "More actions" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Connect agent" })).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Switch to dark appearance" }),
  ).toBeVisible();
});

test("More closes when keyboard focus leaves its trigger and actions", async () => {
  toolbarWidth(640);
  await sample();
  const more = screen.getByRole("button", { name: "More actions" });
  fireEvent.click(more);
  const primary = screen.getByRole("button", { name: "Build prompt" });
  act(() => {
    more.focus();
    primary.focus();
  });
  expect(more).toHaveAttribute("aria-expanded", "false");
  expect(primary).toHaveFocus();
});

test("resizing an open prompt builder never places the feedback drawer above it", async () => {
  const media = Object.assign(new EventTarget(), {
    matches: true,
    media: "(min-width: 1280px)",
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
  });
  const original = window.matchMedia;
  vi.stubGlobal("matchMedia", (query: string) =>
    query === media.media ? media : original(query),
  );
  await sample();
  fireEvent.click(screen.getByRole("button", { name: "Feedback: 0 comments" }));
  fireEvent.click(screen.getAllByRole("button", { name: "Build prompt" })[0]);
  act(() => {
    media.matches = false;
    media.dispatchEvent(new Event("change"));
  });
  expect(
    screen.getByRole("dialog", { name: "Build your next prompt" }),
  ).toHaveAttribute("open");
  expect(document.getElementById("feedback-dialog")).not.toHaveAttribute(
    "open",
  );
});

test("editing a review note survives appearance updates without replacing the focused editor", async () => {
  await sample();
  fireEvent.click(screen.getByText("Notes & checklist"));
  const editor = screen.getByRole("textbox", { name: "Review note" });
  editor.focus();
  fireEvent.change(editor, { target: { value: "Check this contract." } });
  fireEvent.click(
    screen.getByRole("button", { name: "Switch to dark appearance" }),
  );
  expect(screen.getByRole("textbox", { name: "Review note" })).toBe(editor);
  expect(editor).toHaveFocus();
  expect(editor).toHaveValue("Check this contract.");
  expect(document.documentElement).toHaveAttribute("data-theme", "dark");
});

test("notes, checklist decisions, review progress, and appearance survive reopening the sample", async () => {
  const view = await sample();
  fireEvent.click(screen.getByText("Notes & checklist"));
  fireEvent.change(screen.getByRole("textbox", { name: "Review note" }), {
    target: { value: "Follow the status field." },
  });
  fireEvent.click(screen.getByLabelText("All terminal states are represented"));
  fireEvent.click(
    screen.getByRole("button", { name: "Switch to dark appearance" }),
  );
  fireEvent.click(screen.getByRole("button", { name: /Mark reviewed & next/ }));
  view.unmount();
  await sample();
  expect(
    screen.getByRole("button", {
      name: "Review summary: 1 of 10 sections reviewed",
    }),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: /Pipeline: pipeline\/serialize.ts/ }),
  );
  fireEvent.click(screen.getByText("Notes & checklist"));
  expect(screen.getByRole("textbox", { name: "Review note" })).toHaveValue(
    "Follow the status field.",
  );
  expect(
    screen.getByLabelText("All terminal states are represented"),
  ).toBeChecked();
  expect(document.documentElement.dataset.theme).toBe("dark");
});

test("mark reviewed follows every behavior and ungrouped section before showing completion", async () => {
  await sample();
  for (let index = 0; index < 8; index++)
    fireEvent.click(
      screen.getByRole("button", { name: /Mark reviewed & next/ }),
    );
  expect(
    screen.queryByRole("heading", { name: "All changes reviewed." }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("heading", { name: "Ungrouped changes" }),
  ).toBeInTheDocument();
  for (let index = 0; index < 2; index++)
    fireEvent.click(
      screen.getByRole("button", { name: /Mark reviewed & next/ }),
    );
  expect(
    screen.getByRole("heading", { name: "All changes reviewed." }),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: /View reviewed changes/ }),
  );
  expect(
    screen.getByRole("combobox", { name: "Filter review status" }),
  ).toHaveValue("reviewed");
  expect(
    within(
      screen.getByRole("navigation", { name: "Changed sections" }),
    ).getAllByRole("button"),
  ).toHaveLength(10);
});

test("keyboard navigation respects text editing and open dialogs", async () => {
  await sample();
  fireEvent.keyDown(document.body, { key: "j" });
  expect(
    screen.getByRole("region", { name: "ui/RunStatus.tsx code diff" }),
  ).toBeInTheDocument();
  fireEvent.keyDown(document.body, { key: "k" });
  expect(
    screen.getByRole("region", { name: "pipeline/serialize.ts code diff" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByText("Notes & checklist"));
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Review note" }), {
    key: "r",
  });
  expect(
    screen.getByRole("button", {
      name: "Review summary: 0 of 10 sections reviewed",
    }),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Help and keyboard shortcuts" }),
  );
  fireEvent.keyDown(document.body, { key: "r" });
  expect(
    screen.getByRole("button", {
      name: "Review summary: 0 of 10 sections reviewed",
    }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Close help" }));
  fireEvent.keyDown(document.body, { key: "r" });
  expect(
    screen.getByRole("button", {
      name: "Review summary: 1 of 10 sections reviewed",
    }),
  ).toBeInTheDocument();
});

test("search and review filters keep ungrouped changes accessible", async () => {
  await sample();
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Search all changes" }),
    { target: { value: "LOG_LEVEL" } },
  );
  expect(
    screen.getByRole("region", { name: ".env.example code diff" }),
  ).toBeInTheDocument();
  fireEvent.change(
    screen.getByRole("combobox", { name: "Filter review status" }),
    { target: { value: "reviewed" } },
  );
  expect(
    screen.getByRole("heading", { name: "No matching changes." }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show all changes" }));
  expect(
    screen.getByRole("heading", { name: "All changes" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Ungrouped changes/ }));
  expect(
    within(
      screen.getByRole("navigation", { name: "Changed sections" }),
    ).getAllByRole("button"),
  ).toHaveLength(2);
});

test("connects Git, retains it after a failed connection, shows MCP setup, and disconnects", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, options?: RequestInit) => {
      if (url === "/api/repository")
        return JSON.parse(String(options?.body)).path === "/bad"
          ? json({ error: "Not a Git repository." }, 400)
          : json({ revision: 1, workspace: repo });
      return json({
        revision: 0,
        workspace: null,
        defaultPath: "/tmp/real-repo",
        mcpConfig: config,
      });
    }),
  );
  render(<App />);
  await waitFor(() =>
    expect(
      screen.getByRole("textbox", { name: "Local repository" }),
    ).toHaveValue("/tmp/real-repo"),
  );
  fireEvent.click(screen.getByRole("button", { name: /Open repository/ }));
  await screen.findByRole("heading", { name: "All changes" });
  fireEvent.click(screen.getByRole("button", { name: "Repository settings" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Repository path" }), {
    target: { value: "/bad" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Open repository" }));
  expect(await screen.findByText("Not a Git repository.")).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Close repository settings" }),
  );
  expect(
    screen.getByRole("region", { name: "run.ts code diff" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Connect agent" }));
  expect(
    screen.getByRole("textbox", { name: "MCP client configuration" }),
  ).toHaveValue(JSON.stringify(config, null, 2));
  fireEvent.click(screen.getByRole("button", { name: "Close agent setup" }));
  fireEvent.click(screen.getByRole("button", { name: "Repository settings" }));
  fireEvent.click(screen.getByRole("button", { name: "Close repository" }));
  expect(
    await screen.findByRole("heading", { name: /Follow the change/ }),
  ).toBeInTheDocument();
});

test("refreshing a changed diff resets old decisions and exposes a stale agent plan", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      json({
        revision: url === "/api/refresh" ? 2 : 1,
        workspace:
          url === "/api/refresh"
            ? { ...repo, version: "git-v2", planStatus: "stale" }
            : repo,
        mcpConfig: config,
      }),
    ),
  );
  render(<App />);
  await screen.findByRole("heading", { name: "All changes" });
  fireEvent.click(screen.getByRole("button", { name: /Mark reviewed & next/ }));
  expect(
    screen.getByRole("button", {
      name: "Review summary: 1 of 2 sections reviewed",
    }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Refresh diff" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", {
        name: "Review summary: 0 of 2 sections reviewed",
      }),
    ).toBeInTheDocument(),
  );
  expect(
    screen.getByText("The diff changed. Ask your agent for a new review path."),
  ).toBeInTheDocument();
});

test("polling accepts a new agent path for the same diff without losing progress", async () => {
  vi.useFakeTimers();
  let proposed = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      json({
        revision: proposed ? 2 : 1,
        workspace: proposed
          ? {
              ...repo,
              planStatus: "current",
              groups: [
                {
                  id: "status",
                  title: "Expose failure",
                  description: "Follow the status.",
                  sections: ["first", "second"],
                  explanations: { first: "Start with the contract." },
                },
              ],
            }
          : repo,
      }),
    ),
  );
  try {
    render(<App />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Mark reviewed & next/ }),
    );
    proposed = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(
      screen.getByRole("heading", { name: "Expose failure" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText("Context", { exact: true }));
    expect(screen.getByText("Start with the contract.")).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "Review summary: 1 of 2 sections reviewed",
      }),
    ).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test("context expansion stays with its section while navigating the review", async () => {
  await sample();
  const region = () =>
    screen.getByRole("region", { name: "pipeline/serialize.ts code diff" });
  expect(region()).not.toHaveTextContent("API_VERSION");
  fireEvent.click(
    screen.getByRole("button", { name: "Show surrounding context" }),
  );
  expect(region()).toHaveTextContent("API_VERSION");
  fireEvent.click(screen.getByRole("button", { name: "Next step" }));
  expect(
    screen.getByRole("button", { name: "Show surrounding context" }),
  ).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(screen.getByRole("button", { name: "Previous step" }));
  expect(region()).toHaveTextContent("API_VERSION");
});

test("a clean Git repository shows no changes rather than a completed review", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      json({ revision: 1, workspace: { ...repo, sections: [] } }),
    ),
  );
  render(<App />);
  expect(
    await screen.findByRole("heading", { name: "No changes to review." }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "All changes reviewed." }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Mark reviewed/ }),
  ).not.toBeInTheDocument();
});

test("an older workspace response cannot overwrite a repository opened while it was loading", async () => {
  let finishLoad!: (value: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      url === "/api/repository"
        ? Promise.resolve(json({ revision: 1, workspace: repo }))
        : new Promise<Response>((resolve) => {
            finishLoad = resolve;
          }),
    ),
  );
  render(<App />);
  fireEvent.change(screen.getByRole("textbox", { name: "Local repository" }), {
    target: { value: "/tmp/real-repo" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Open repository/ }));
  await screen.findByRole("heading", { name: "All changes" });
  await act(async () => {
    finishLoad(json({ revision: 0, workspace: null, mcpConfig: config }));
  });
  expect(
    screen.getByRole("region", { name: "run.ts code diff" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Connect agent" }));
  expect(
    screen.getByRole("textbox", { name: "MCP client configuration" }),
  ).toHaveValue(JSON.stringify(config, null, 2));
});

test("opens progress saved by the original vanilla app without changing its storage format", async () => {
  localStorage.setItem("ordiff.appearance", "dark");
  localStorage.setItem(
    "ordiff.review.v2.demo",
    JSON.stringify({
      version: "pipeline-demo-v1",
      view: "behavior",
      groupId: "failure-status",
      activeId: "status-ui",
      reviewed: ["status-pipeline"],
      notes: { "status-ui": "Saved before the React migration." },
      checks: { "status-ui": [0] },
      theme: "dark",
      query: "",
      filter: "all",
      revisit: false,
    }),
  );
  await sample();
  expect(
    screen.getByRole("region", { name: "ui/RunStatus.tsx code diff" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", {
      name: "Review summary: 1 of 10 sections reviewed",
    }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByText("Notes & checklist"));
  expect(screen.getByRole("textbox", { name: "Review note" })).toHaveValue(
    "Saved before the React migration.",
  );
  expect(
    screen.getByLabelText("Failure is distinct from running"),
  ).toBeChecked();
  expect(document.documentElement.dataset.theme).toBe("dark");
});

test("reviewing still works when browser storage is unavailable", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage disabled");
  });
  await sample();
  fireEvent.click(screen.getByText("Notes & checklist"));
  fireEvent.change(screen.getByRole("textbox", { name: "Review note" }), {
    target: { value: "Session-only note." },
  });
  expect(
    screen.getByText("Available for this session only."),
  ).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Review note" })).toHaveValue(
    "Session-only note.",
  );
  fireEvent.click(screen.getByRole("button", { name: /Mark reviewed & next/ }));
  expect(
    screen.getByRole("button", {
      name: "Review summary: 1 of 10 sections reviewed",
    }),
  ).toBeInTheDocument();
});

test("mobile search opens even when the shortcut arrives before the viewport change event", async () => {
  let matches = false;
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return matches;
    },
    addEventListener: (_event: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) =>
      listeners.delete(listener),
  }));
  await sample();
  matches = true;
  fireEvent.keyDown(document.body, { key: "k", metaKey: true });
  act(() => {
    for (const listener of listeners) listener();
  });
  expect(
    screen.getByRole("dialog", { name: "Review navigation" }),
  ).toBeVisible();
  expect(
    screen.getByRole("searchbox", { name: "Search all changes" }),
  ).toHaveFocus();
});

test("all section navigation stays in the sidebar and distinguishes hunks in the same file", async () => {
  await sample();
  fireEvent.click(screen.getByRole("button", { name: /All changes/ }));
  const navigation = within(
    screen.getByRole("complementary", { name: "Review navigation" }),
  );
  const sections = within(
    navigation.getByRole("navigation", { name: "Changed sections" }),
  );
  const status = sections.getByRole("button", {
    name: /ui\/RunStatus.tsx.*RunStatus/,
  });
  const actions = sections.getByRole("button", {
    name: /ui\/RunStatus.tsx.*RunActions/,
  });
  expect(status).not.toBe(actions);
  fireEvent.click(actions);
  expect(
    screen.getByRole("region", { name: "ui/RunStatus.tsx code diff" }),
  ).toHaveTextContent("Retry run");
  expect(actions).toHaveAttribute("aria-current", "true");
});

test("agent context starts collapsed and closes when moving to another section", async () => {
  await sample();
  const context = screen
    .getByText("Context", { exact: true })
    .closest("details")!;
  expect(context.open).toBe(false);
  fireEvent.click(screen.getByText("Context", { exact: true }));
  expect(context.open).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Next step" }));
  expect(
    screen.getByText("Context", { exact: true }).closest("details"),
  ).not.toHaveAttribute("open");
});

test("continuing from reviewed code advances without reversing the review decision", async () => {
  await sample();
  fireEvent.click(screen.getByRole("button", { name: /Mark reviewed & next/ }));
  fireEvent.click(screen.getByRole("button", { name: "Previous step" }));
  fireEvent.click(screen.getByRole("button", { name: /^Continue/ }));
  expect(
    screen.getByRole("button", {
      name: "Review summary: 1 of 10 sections reviewed",
    }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("region", { name: "ui/RunStatus.tsx code diff" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Previous step" }));
  fireEvent.click(screen.getByRole("button", { name: "Mark unreviewed" }));
  expect(
    screen.getByRole("button", {
      name: "Review summary: 0 of 10 sections reviewed",
    }),
  ).toBeInTheDocument();
});

test("holding the review shortcut does not mark additional sections", async () => {
  await sample();
  fireEvent.keyDown(document.body, { key: "r" });
  fireEvent.keyDown(document.body, { key: "r", repeat: true });
  expect(
    screen.getByRole("button", {
      name: "Review summary: 1 of 10 sections reviewed",
    }),
  ).toBeInTheDocument();
});

test("undo restores the marked section and preserves notes written after marking", async () => {
  await sample();
  fireEvent.click(screen.getByText("Notes & checklist"));
  fireEvent.click(screen.getByLabelText("All terminal states are represented"));
  fireEvent.click(screen.getByRole("button", { name: /Mark reviewed & next/ }));
  fireEvent.click(screen.getByText("Notes & checklist"));
  fireEvent.change(screen.getByRole("textbox", { name: "Review note" }), {
    target: { value: "Keep this later note." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(
    screen.getByRole("region", { name: "pipeline/serialize.ts code diff" }),
  ).toHaveFocus();
  expect(
    screen.getByRole("button", {
      name: "Review summary: 0 of 10 sections reviewed",
    }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByText("Notes & checklist"));
  expect(
    screen.getByLabelText("All terminal states are represented"),
  ).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Next step" }));
  fireEvent.click(screen.getByText("Notes & checklist"));
  expect(screen.getByRole("textbox", { name: "Review note" })).toHaveValue(
    "Keep this later note.",
  );
  expect(
    screen.queryByRole("button", { name: "Undo" }),
  ).not.toBeInTheDocument();
});

test("undo expires six seconds after the most recent mark", async () => {
  await sample();
  vi.useFakeTimers();
  try {
    fireEvent.click(
      screen.getByRole("button", { name: /Mark reviewed & next/ }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Mark reviewed & next/ }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(
      screen.queryByRole("button", { name: "Undo" }),
    ).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test("undo is invalidated when refreshing to a different diff", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      json({
        revision: url === "/api/refresh" ? 2 : 1,
        workspace:
          url === "/api/refresh" ? { ...repo, version: "git-v2" } : repo,
      }),
    ),
  );
  render(<App />);
  await screen.findByRole("heading", { name: "All changes" });
  fireEvent.click(screen.getByRole("button", { name: /Mark reviewed & next/ }));
  expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Refresh diff" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Undo" }),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.getByRole("button", {
      name: "Review summary: 0 of 2 sections reviewed",
    }),
  ).toBeInTheDocument();
});

test("continuing from search reveals the next pending section outside the search results", async () => {
  await sample();
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Search all changes" }),
    { target: { value: "LOG_LEVEL" } },
  );
  fireEvent.click(screen.getByRole("button", { name: /Mark reviewed & next/ }));
  expect(
    screen.getByRole("region", { name: "README.md code diff" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("searchbox", { name: "Search all changes" }),
  ).toHaveValue("");
});

test("undo after completion restores only the last mark and revisiting keeps completion intact", async () => {
  await sample();
  for (let index = 0; index < 10; index++)
    fireEvent.click(
      screen.getByRole("button", { name: /Mark reviewed & next/ }),
    );
  expect(
    screen.getByRole("heading", { name: "All changes reviewed." }),
  ).toHaveFocus();
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(
    screen.getByRole("button", {
      name: "Review summary: 9 of 10 sections reviewed",
    }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("region", { name: "README.md code diff" }),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Mark reviewed & next/ }));
  fireEvent.click(
    screen.getByRole("button", { name: /View reviewed changes/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: /^Continue/ }));
  expect(
    screen.getByRole("dialog", { name: "All changes reviewed." }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", {
      name: "Review summary: 10 of 10 sections reviewed",
    }),
  ).toBeInTheDocument();
});

test("changing repositories expires undo even when their diff version matches", async () => {
  const another = {
    ...repo,
    repo: { ...repo.repo, path: "/tmp/another-repo", name: "another-repo" },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      json({
        revision: url === "/api/repository" ? 2 : 1,
        workspace: url === "/api/repository" ? another : repo,
      }),
    ),
  );
  render(<App />);
  await screen.findByRole("heading", { name: "All changes" });
  fireEvent.click(screen.getByRole("button", { name: /Mark reviewed & next/ }));
  expect(screen.getByRole("button", { name: "Undo" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Repository settings" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Repository path" }), {
    target: { value: "/tmp/another-repo" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Open repository" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Undo" }),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.getByRole("button", {
      name: "Review summary: 0 of 2 sections reviewed",
    }),
  ).toBeInTheDocument();
});

test("undo still reveals its section after an agent replaces the behavior groups", async () => {
  let proposed = false;
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      json({
        revision: proposed ? 2 : 1,
        workspace: {
          ...repo,
          planStatus: "current",
          groups: [
            {
              id: proposed ? "new-plan" : "old-plan",
              title: proposed ? "Replacement behavior" : "Original behavior",
              description: "Inspect the status.",
              sections: ["first", "second"],
            },
          ],
        },
      }),
    ),
  );
  try {
    render(<App />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Mark reviewed & next/ }),
    );
    proposed = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(
      screen.getByRole("region", { name: "run.ts code diff" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Replacement behavior" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Review summary: 0 of 2 sections reviewed",
      }),
    ).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});
