import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { App } from "../../src/App";
import type { Workspace } from "../../src/types";

const repo: Workspace = {
  version: "v1",
  repo: {
    name: "current",
    path: "/repos/current",
    branch: "main",
    source: "git",
  },
  groups: [],
  planStatus: "none",
  sections: [
    {
      id: "one",
      path: "one.ts",
      role: "Code",
      language: "TypeScript",
      title: "First",
      lines: [{ type: "add", text: "first", old: null, new: 1 }],
    },
    {
      id: "two",
      path: "two.ts",
      role: "Code",
      language: "TypeScript",
      title: "Second",
      lines: [{ type: "add", text: "second", old: null, new: 1 }],
    },
  ],
};
const recent = [
  { name: "current", path: "/repos/current" },
  { name: "other", path: "/projects/other" },
];
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
const listing = (
  path: string,
  directories: { name: string; path: string }[] = [],
) => ({
  path,
  parentPath: path === "/" ? null : "/",
  homePath: "/home/test",
  breadcrumbs: [
    { name: "/", path: "/" },
    { name: path.split("/").at(-1), path },
  ],
  directories,
});

test("folder browsing receives focus after the native dialog opens", async () => {
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(
    function (this: HTMLDialogElement) {
      this.open = true;
      this.querySelector("button")?.focus();
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      json({ revision: 1, workspace: repo, recentRepositories: recent }),
    ),
  );
  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Switch repository: current" }),
  );
  expect(screen.getByRole("button", { name: "Browse folders" })).toHaveFocus();
});

test("welcome searches recent names and paths and opens a repository in one click", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, options) => {
      if (url === "/api/repository") {
        expect(JSON.parse(options.body).path).toBe("/projects/other");
        return json({
          revision: 2,
          workspace: { ...repo, repo: { ...repo.repo, ...recent[1] } },
          recentRepositories: [...recent].reverse(),
        });
      }
      return json({
        revision: 1,
        workspace: null,
        defaultPath: "/repos",
        recentRepositories: recent,
      });
    }),
  );
  render(<App />);
  const search = await screen.findByRole("searchbox", {
    name: "Search recent repositories",
  });
  fireEvent.change(search, { target: { value: "PROJECTS" } });
  expect(
    screen.queryByRole("button", { name: "Open current /repos/current" }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Open other /projects/other" }),
  );
  expect(
    await screen.findByRole("button", { name: "Switch repository: other" }),
  ).toBeVisible();
  expect(
    screen.getByRole("region", { name: "one.ts code diff" }),
  ).toBeVisible();
});

test("removing the last recent repository returns focus to browsing and hides the unused filter", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) =>
      json({
        revision: url === "/api/recent-repositories/remove" ? 2 : 1,
        workspace: repo,
        recentRepositories:
          url === "/api/recent-repositories/remove" ? [] : [recent[0]],
      }),
    ),
  );
  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Switch repository: current" }),
  );
  const remove = screen.getByRole("button", {
    name: "Remove current /repos/current from recent repositories",
  });
  remove.focus();
  fireEvent.click(remove);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Browse folders" }),
    ).toHaveFocus(),
  );
  expect(
    screen.queryByRole("searchbox", { name: "Search recent repositories" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Repository path" })).toHaveValue(
    "/repos/current",
  );
});

test("switcher removal and a failed recent open preserve current review progress", async () => {
  let history = [...recent];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      if (url === "/api/repository")
        return json({ error: "Repository moved. Choose another folder." }, 400);
      if (url === "/api/recent-repositories/remove") history = history.slice(1);
      return json({
        revision: history.length === 2 ? 1 : 2,
        workspace: repo,
        recentRepositories: history,
      });
    }),
  );
  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: /Mark reviewed & next/ }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Switch repository: current" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Open a repository" });
  expect(within(dialog).getByText("Current", { exact: true })).toBeVisible();
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: "Remove current /repos/current from recent repositories",
    }),
  );
  await waitFor(() =>
    expect(
      within(dialog).queryByText("/repos/current", { selector: "small" }),
    ).not.toBeInTheDocument(),
  );
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Open other /projects/other" }),
  );
  expect(
    await within(dialog).findByText("Repository moved. Choose another folder."),
  ).toBeVisible();
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Close repository settings" }),
  );
  expect(
    screen.getByRole("region", { name: "two.ts code diff" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", {
      name: "Review summary: 1 of 2 sections reviewed",
    }),
  ).toBeVisible();
});

test("browser browsing falls back home, navigates folders, shows hidden folders, and explicitly opens", async () => {
  let opened = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, options) => {
      if (String(url).startsWith("/api/directories")) {
        const params = new URL(String(url), "http://localhost").searchParams;
        const path = params.get("path");
        if (path === "/missing")
          return json({ error: "Folder unavailable." }, 400);
        if (path === "/home/test/project") return json(listing(path));
        return json(
          listing("/home/test", [
            { name: "project", path: "/home/test/project" },
            ...(params.get("showHidden") === "true"
              ? [{ name: ".hidden", path: "/home/test/.hidden" }]
              : []),
          ]),
        );
      }
      if (url === "/api/repository") {
        opened++;
        expect(JSON.parse(options.body).path).toBe("/home/test/project");
        return json({
          revision: 1,
          workspace: repo,
          recentRepositories: recent,
        });
      }
      return json({
        revision: 0,
        workspace: null,
        defaultPath: "/missing",
        recentRepositories: [],
      });
    }),
  );
  render(<App />);
  await screen.findByDisplayValue("/missing");
  fireEvent.click(screen.getByRole("button", { name: "Browse folders" }));
  await screen.findByRole("button", { name: "Browse project" });
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Show hidden folders" }),
  );
  expect(
    await screen.findByRole("button", { name: "Browse .hidden" }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Browse project" }));
  await screen.findByDisplayValue("/home/test/project");
  expect(opened).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "Open this folder" }));
  expect(
    await screen.findByRole("region", { name: "one.ts code diff" }),
  ).toBeVisible();
  expect(opened).toBe(1);
});

test("cancelling browsing ignores its pending response and retains the manual path", async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) =>
      String(url).startsWith("/api/directories")
        ? new Promise<Response>((resolve) => {
            finish = resolve;
          })
        : json({
            revision: 0,
            workspace: null,
            defaultPath: "/repos",
            recentRepositories: [],
          }),
    ),
  );
  render(<App />);
  const input = await screen.findByRole("textbox", {
    name: "Local repository",
  });
  fireEvent.change(input, { target: { value: "~/draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Browse folders" }));
  fireEvent.click(screen.getByRole("button", { name: "Back to repositories" }));
  await act(async () => {
    finish(json(listing("/late")));
  });
  expect(screen.getByRole("textbox", { name: "Local repository" })).toHaveValue(
    "~/draft",
  );
  expect(
    screen.queryByRole("button", { name: "Open this folder" }),
  ).not.toBeInTheDocument();
});

test("an older workspace response cannot overwrite recent history from an explicit open", async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) =>
      url === "/api/repository"
        ? json({
            revision: 2,
            workspace: repo,
            recentRepositories: [recent[0]],
          })
        : new Promise<Response>((resolve) => {
            finish = resolve;
          }),
    ),
  );
  render(<App />);
  fireEvent.change(screen.getByRole("textbox", { name: "Local repository" }), {
    target: { value: "/repos/current" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Open repository/ }));
  await screen.findByRole("button", { name: "Switch repository: current" });
  await act(async () => {
    finish(
      json({ revision: 1, workspace: null, recentRepositories: [recent[1]] }),
    );
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Switch repository: current" }),
  );
  expect(screen.getByText("Current", { exact: true })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Open other /projects/other" }),
  ).not.toBeInTheDocument();
});

test("native folder selection opens its result and cancellation retains the chooser", async () => {
  vi.stubGlobal("isTauri", true);
  let selection: string | null = null;
  vi.stubGlobal("__TAURI_INTERNALS__", {
    invoke: vi.fn(async (command, args) => {
      expect(command).toBe("pick_repository_directory");
      expect(args.initialPath).toBe("/repos");
      return selection;
    }),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url, options) => {
      if (url === "/api/repository") {
        expect(JSON.parse(options.body).path).toBe("/repos/current");
        return json({
          revision: 1,
          workspace: repo,
          recentRepositories: recent,
        });
      }
      return json({
        revision: 0,
        workspace: null,
        defaultPath: "/repos",
        recentRepositories: [],
      });
    }),
  );
  render(<App />);
  await screen.findByDisplayValue("/repos");
  fireEvent.click(screen.getByRole("button", { name: "Browse folders" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Browse folders" }),
    ).toBeEnabled(),
  );
  expect(screen.getByRole("textbox", { name: "Local repository" })).toHaveValue(
    "/repos",
  );
  selection = "/repos/current";
  fireEvent.click(screen.getByRole("button", { name: "Browse folders" }));
  expect(
    await screen.findByRole("region", { name: "one.ts code diff" }),
  ).toBeVisible();
});

test("native selection arriving after the repository dialog is dismissed cannot switch repositories", async () => {
  vi.stubGlobal("isTauri", true);
  let finish!: (path: string) => void;
  vi.stubGlobal("__TAURI_INTERNALS__", {
    invoke: () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      json({ revision: 1, workspace: repo, recentRepositories: recent }),
    ),
  );
  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Switch repository: current" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Browse folders" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Close repository settings" }),
  );
  await act(async () => {
    finish("/projects/other");
  });
  expect(
    screen.getByRole("button", { name: "Switch repository: current" }),
  ).toBeVisible();
  expect(
    screen.getByRole("region", { name: "one.ts code diff" }),
  ).toBeVisible();
});

test("reopening a dismissed chooser permits a fresh action while an old native picker is pending", async () => {
  vi.stubGlobal("isTauri", true);
  vi.stubGlobal("__TAURI_INTERNALS__", { invoke: () => new Promise(() => {}) });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      json({ revision: 1, workspace: repo, recentRepositories: recent }),
    ),
  );
  render(<App />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Switch repository: current" }),
  );
  Object.defineProperty(
    screen.getByRole("dialog", { name: "Open a repository" }),
    "getAnimations",
    {
      value: () => [{ finished: new Promise(() => {}) }],
    },
  );
  fireEvent.click(screen.getByRole("button", { name: "Browse folders" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Close repository settings" }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Switch repository: current" }),
  );
  expect(screen.getByRole("button", { name: "Browse folders" })).toBeEnabled();
});

test("repeated submission starts only one repository request", async () => {
  let finish!: (response: Response) => void;
  let opens = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      if (url === "/api/repository") {
        opens++;
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      }
      return json({
        revision: 0,
        workspace: null,
        defaultPath: "/repos/current",
        recentRepositories: [],
      });
    }),
  );
  render(<App />);
  const input = await screen.findByDisplayValue("/repos/current");
  const form = input.closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(screen.getByRole("button", { name: "Opening…" })).toBeDisabled();
  await act(async () => {
    finish(json({ revision: 1, workspace: repo, recentRepositories: recent }));
  });
  expect(
    screen.getByRole("region", { name: "one.ts code diff" }),
  ).toBeVisible();
  expect(opens).toBe(1);
});

test("late folder navigation cannot replace a newer Home selection", async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      if (String(url).startsWith("/api/directories")) {
        const path = new URL(String(url), "http://localhost").searchParams.get(
          "path",
        );
        if (path === "/repos/slow")
          return new Promise<Response>((resolve) => {
            finish = resolve;
          });
        if (path === "/home/test") return json(listing("/home/test"));
        return json(listing("/repos", [{ name: "slow", path: "/repos/slow" }]));
      }
      return json({
        revision: 0,
        workspace: null,
        defaultPath: "/repos",
        recentRepositories: [],
      });
    }),
  );
  render(<App />);
  await screen.findByDisplayValue("/repos");
  fireEvent.click(screen.getByRole("button", { name: "Browse folders" }));
  fireEvent.click(await screen.findByRole("button", { name: "Browse slow" }));
  fireEvent.click(screen.getByRole("button", { name: "Home" }));
  await screen.findByDisplayValue("/home/test");
  await act(async () => {
    finish(json(listing("/repos/slow")));
  });
  expect(screen.getByRole("textbox", { name: "Folder path" })).toHaveValue(
    "/home/test",
  );
});
