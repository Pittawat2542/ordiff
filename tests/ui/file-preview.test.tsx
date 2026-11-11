import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { DiffView } from "../../src/diff-view";
import type { DiffSection } from "../../src/types";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { SafeDocument } from "../../src/components/document-preview";

const markdown: DiffSection = {
  id: "markdown",
  path: "guide.md",
  role: "Docs",
  language: "Markdown",
  lines: [
    { type: "remove", old: 1, new: null, text: "# Old heading" },
    { type: "add", old: null, new: 1, text: "# New heading" },
    { type: "add", old: null, new: 2, text: "- [x] Reviewed **carefully**" },
    {
      type: "add",
      old: null,
      new: 3,
      text: '<script>alert("unsafe")</script>',
    },
  ],
};

const changedBinary: DiffSection = {
  id: "changed-word",
  path: "report.doc",
  role: "Docs",
  binary: true,
  file: {
    kind: "word-doc",
    mimeType: "application/msword",
    before: { size: 100, hash: "original-word" },
    after: { size: 120, hash: "changed-word" },
  },
};

test("changed binary files display both revisions with their own downloads", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(
          new URL(url, "http://localhost").searchParams.get("side") === "before"
            ? "Original report contents"
            : "Updated report contents",
        ),
    ),
  );
  render(<DiffView section={changedBinary} version="v1" />);
  const original = await screen.findByRole("region", { name: "Original file" });
  const changed = screen.getByRole("region", { name: "Working tree file" });
  expect(
    await within(original).findByText("Original report contents"),
  ).toBeVisible();
  expect(
    await within(changed).findByText("Updated report contents"),
  ).toBeVisible();
  expect(
    within(original).queryByText("Updated report contents"),
  ).not.toBeInTheDocument();
  expect(
    within(original).getByRole("link", { name: /Download/ }),
  ).toHaveAttribute("href", expect.stringContaining("side=before"));
  expect(
    within(changed).getByRole("link", { name: /Download/ }),
  ).toHaveAttribute("href", expect.stringContaining("side=after"));
  expect(
    screen.queryByRole("group", { name: "File version" }),
  ).not.toBeInTheDocument();
});

test("a failed original preview can retry without replacing the working revision", async () => {
  let originalAttempts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const original =
        new URL(url, "http://localhost").searchParams.get("side") === "before";
      if (original && ++originalAttempts === 1)
        return new Response(
          JSON.stringify({ error: "Original preview unavailable." }),
          { status: 409 },
        );
      return new Response(
        original ? "Original report contents" : "Updated report contents",
      );
    }),
  );
  render(<DiffView section={changedBinary} version="v1" />);
  const original = await screen.findByRole("region", { name: "Original file" });
  const changed = screen.getByRole("region", { name: "Working tree file" });
  expect(await within(original).findByRole("alert")).toHaveTextContent(
    "Original preview unavailable.",
  );
  expect(
    await within(changed).findByText("Updated report contents"),
  ).toBeVisible();
  fireEvent.click(
    within(original).getByRole("button", { name: "Retry preview" }),
  );
  expect(
    await within(original).findByText("Original report contents"),
  ).toBeVisible();
  expect(within(changed).getByText("Updated report contents")).toBeVisible();
});

test.each(["added", "deleted"])(
  "%s binaries preview only their existing revision",
  async (change) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Existing report contents")),
    );
    render(
      <DiffView
        section={{
          ...changedBinary,
          file: {
            ...changedBinary.file!,
            before: change === "added" ? null : changedBinary.file!.before,
            after: change === "deleted" ? null : changedBinary.file!.after,
          },
        }}
        version="v1"
      />,
    );
    expect(await screen.findByText("Existing report contents")).toBeVisible();
    expect(
      screen.queryByRole("group", { name: "File comparison" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Download/ })).toHaveAttribute(
      "href",
      expect.stringContaining(
        change === "added" ? "side=after" : "side=before",
      ),
    );
  },
);
test("Markdown switches between the original diff and a rendered proposed preview", async () => {
  render(<DiffView section={markdown} />);
  expect(
    screen.getByRole("region", { name: "guide.md code diff" }),
  ).toHaveTextContent("Old heading");
  fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
  expect(
    await screen.findByRole("heading", { name: "New heading" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "Old heading" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("checkbox")).toBeChecked();
  expect(document.querySelector("script")).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "Diff" }));
  expect(
    screen.getByRole("region", { name: "guide.md code diff" }),
  ).toHaveTextContent("Old heading");
});

test("changing sections resets a Markdown preview back to its original diff", async () => {
  const view = render(<DiffView section={markdown} />);
  fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
  await screen.findByRole("heading", { name: "New heading" });
  view.rerender(
    <DiffView section={{ ...markdown, id: "second", path: "second.md" }} />,
  );
  expect(
    screen.getByRole("region", { name: "second.md code diff" }),
  ).toBeInTheDocument();
});

test("CSV previews render cells as text and preserve the diff view", async () => {
  render(
    <DiffView
      section={{
        id: "csv",
        path: "rows.csv",
        role: "Code",
        lines: [
          { type: "add", old: null, new: 1, text: "Name,Value" },
          { type: "add", old: null, new: 2, text: '"<script>bad</script>",42' },
        ],
      }}
    />,
  );
  fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
  const table = await screen.findByRole("table");
  expect(within(table).getByText("<script>bad</script>")).toBeInTheDocument();
  expect(document.querySelector("script")).toBeNull();
});

test("image previews show a useful error and download action when file bytes are stale", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: "This file changed. Refresh the diff before previewing it.",
          }),
          { status: 409, headers: { "content-type": "application/json" } },
        ),
    ),
  );
  const section: DiffSection = {
    id: "image",
    path: "diagram.png",
    role: "Code",
    binary: true,
    file: {
      kind: "image",
      mimeType: "image/png",
      before: null,
      after: { size: 20, hash: "image-hash" },
    },
  };
  render(<DiffView section={section} version="version-1" />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This file changed",
  );
  expect(screen.getByRole("link", { name: /Download/ })).toHaveAttribute(
    "href",
    expect.stringContaining("sectionId=image"),
  );
  expect(
    screen.getByRole("button", { name: "Retry preview" }),
  ).toBeInTheDocument();
});

test("unsupported binaries show file details without trying to render them", async () => {
  render(
    <DiffView
      section={{
        id: "archive",
        path: "release.zip",
        role: "Code",
        binary: true,
        file: {
          kind: "unsupported",
          mimeType: "application/octet-stream",
          before: null,
          after: { size: 1024, hash: "zip-hash" },
        },
      }}
      version="v1"
    />,
  );
  expect(await screen.findByText(/No inline preview/)).toBeVisible();
  expect(screen.getByRole("link", { name: /Download/ })).toBeInTheDocument();
});

test("Word previews render the contents of a real DOCX document", async () => {
  const bytes = await readFile(
    `${process.cwd()}/node_modules/mammoth/test/test-data/single-paragraph.docx`,
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array(bytes))),
  );
  render(
    <DiffView
      section={{
        id: "word",
        path: "report.docx",
        role: "Docs",
        binary: true,
        file: {
          kind: "word",
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          before: null,
          after: { size: bytes.length, hash: "docx" },
        },
      }}
      version="v1"
    />,
  );
  expect(
    await screen.findByText("Walking on imported air", {}, { timeout: 5000 }),
  ).toBeVisible();
});

test("damaged Word documents show a recoverable error and keep the download available", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("Invalid DOCX contents")),
  );
  render(
    <DiffView
      section={{
        id: "damaged-word",
        path: "damaged.docx",
        role: "Docs",
        binary: true,
        file: {
          kind: "word",
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          before: null,
          after: { size: 21, hash: "damaged" },
        },
      }}
      version="v1"
    />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /could not be read/i,
  );
  expect(screen.getByRole("button", { name: "Retry preview" })).toBeVisible();
  expect(screen.getByRole("link", { name: /Download/ })).toBeVisible();
});

test("spreadsheet previews render workbook cells and switch between worksheets", async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Status").addRows([
    ["Stage", "Result"],
    ["Pipeline", "Failed"],
  ]);
  workbook.addWorksheet("Notes").addRows([["Release notes"]]);
  const bytes = await workbook.xlsx.writeBuffer();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array(bytes))),
  );
  render(
    <DiffView
      section={{
        id: "xlsx",
        path: "results.xlsx",
        role: "Docs",
        binary: true,
        file: {
          kind: "spreadsheet",
          mimeType:
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          before: null,
          after: { size: bytes.byteLength, hash: "xlsx" },
        },
      }}
      version="v1"
    />,
  );
  expect(
    await screen.findByText("Pipeline", {}, { timeout: 5000 }),
  ).toBeVisible();
  fireEvent.change(screen.getByRole("combobox", { name: "Worksheet" }), {
    target: { value: "1" },
  });
  expect(screen.getByText("Release notes")).toBeVisible();
});

test("document HTML preserves content while removing active markup and remote image requests", async () => {
  render(
    <SafeDocument
      html={
        '<h1>Review notes</h1><p>Keep this text.</p><script>alert(1)</script><img src="https://example.com/track.png" onerror="alert(1)"><a href="javascript:alert(1)">Unsafe link</a>'
      }
    />,
  );
  expect(
    await screen.findByRole("heading", { name: "Review notes" }),
  ).toBeVisible();
  expect(screen.getByText("Keep this text.")).toBeVisible();
  expect(document.querySelector("script")).toBeNull();
  expect(document.querySelector("[onerror]")).toBeNull();
  expect(document.querySelector("img")).not.toHaveAttribute("src");
  expect(document.querySelector("a")).not.toHaveAttribute("href");
});
