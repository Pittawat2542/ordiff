import { StrictMode } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { redo, undo } from "@codemirror/commands";
import { App } from "../../src/App";

beforeEach(() => {
  history.replaceState(null, "", "/tools/text-diff");
  document.documentElement.dataset.theme = "light";
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("Unexpected request"))),
  );
});

afterEach(() => history.replaceState(null, "", "/"));

async function openUtility() {
  const result = render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await screen.findByRole("heading", { name: "Text diff", level: 1 });
  await screen.findByRole("textbox", { name: "Original text" });
  return result;
}

function editor(name: "Original" | "Modified") {
  const view = EditorView.findFromDOM(
    screen.getByRole("textbox", { name: `${name} text` }),
  );
  if (!view) throw new Error("Editor has not mounted");
  return view;
}

function replace(name: "Original" | "Modified", text: string) {
  const view = editor(name);
  act(() =>
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
    }),
  );
}

test("the direct utility route mounts independently without workspace requests or stored drafts", async () => {
  localStorage.setItem("ordiff.appearance", "dark");
  const first = await openUtility();
  expect(fetch).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: "Open repository" }),
  ).not.toBeInTheDocument();
  expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  replace("Original", "Private draft");
  expect(Object.keys(localStorage)).toEqual(["ordiff.appearance"]);
  first.unmount();
  await openUtility();
  expect(editor("Original").state.doc.toString()).toBe("");
  expect(fetch).not.toHaveBeenCalled();
});

test("trailing-slash URLs open the same utility", async () => {
  history.replaceState(null, "", "/tools/text-diff/");
  await openUtility();
  expect(fetch).not.toHaveBeenCalled();
});

test("live comparison keeps both editors stable through edits, wrapping, and appearance changes", async () => {
  await openUtility();
  const original = editor("Original"),
    modified = editor("Modified");
  expect(screen.getByRole("status")).toHaveTextContent(/Paste text/);
  expect(screen.getByRole("button", { name: "Next change" })).toBeDisabled();
  replace("Original", "The old sentence.\nshared line");
  replace("Modified", "The new sentence.\nshared line");
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("1 changed block"),
  );
  expect(document.querySelector(".cm-changedText")).toBeInTheDocument();
  expect(original.contentDOM).toHaveClass("cm-lineWrapping");
  fireEvent.click(screen.getByRole("button", { name: "Wrap lines" }));
  expect(original.contentDOM).not.toHaveClass("cm-lineWrapping");
  fireEvent.click(
    screen.getByRole("button", { name: "Switch to dark appearance" }),
  );
  expect(document.documentElement).toHaveAttribute("data-theme", "dark");
  expect(localStorage.getItem("ordiff.appearance")).toBe("dark");
  expect(editor("Original")).toBe(original);
  expect(editor("Modified")).toBe(modified);
  act(() => undo(modified));
  expect(modified.state.doc.toString()).toBe("");
  act(() => redo(modified));
  expect(modified.state.doc.toString()).toBe("The new sentence.\nshared line");
});

test("swap and clear act on both drafts without persisting their contents", async () => {
  await openUtility();
  replace("Original", "before");
  replace("Modified", "after");
  fireEvent.click(screen.getByRole("button", { name: "Swap" }));
  expect(editor("Original").state.doc.toString()).toBe("after");
  expect(editor("Modified").state.doc.toString()).toBe("before");
  fireEvent.click(screen.getByRole("button", { name: "Clear both" }));
  expect(editor("Original").state.doc.toString()).toBe("");
  expect(editor("Modified").state.doc.toString()).toBe("");
  expect(screen.getByRole("button", { name: "Clear both" })).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent(/Paste text/);
});

test.each([
  ["identical Unicode", "สวัสดี 👋 café", "สวัสดี 👋 café", false],
  ["insertions", "", "inserted", true],
  ["deletions", "deleted", "", true],
  ["case", "Text", "text", true],
  ["spaces", "one two", "one  two", true],
  ["trailing newline", "text", "text\n", true],
  ["blank lines", "one\n\ntwo", "one\ntwo", true],
  ["line endings", "one\r\ntwo", "one\ntwo", false],
])("comparison handles %s", async (_label, before, after, changed) => {
  await openUtility();
  replace("Original", before);
  replace("Modified", after);
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent(
      changed ? /changed block/ : "Texts are identical",
    ),
  );
  expect(
    screen
      .getByRole("button", { name: "Next change" })
      .hasAttribute("disabled"),
  ).toBe(!changed);
});

test("change navigation visits each block and supports undo after clearing", async () => {
  await openUtility();
  replace("Original", "before\nshared\nshared\nshared\nold");
  replace("Modified", "after\nshared\nshared\nshared\nnew");
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("2 changed blocks"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Next change" }));
  expect(editor("Modified").state.selection.main.head).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "Next change" }));
  expect(editor("Modified").state.selection.main.head).toBe(27);
  fireEvent.click(screen.getByRole("button", { name: "Previous change" }));
  expect(editor("Modified").state.selection.main.head).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "Clear both" }));
  act(() => undo(editor("Modified")));
  expect(editor("Modified").state.doc.toString()).toBe(
    "after\nshared\nshared\nshared\nnew",
  );
});
