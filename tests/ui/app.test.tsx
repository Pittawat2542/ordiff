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
    screen.getByRole("button", { name: "Pipeline: pipeline/serialize.ts" }),
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
    expect(screen.getByText("Start with the contract.")).toBeInTheDocument();
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
