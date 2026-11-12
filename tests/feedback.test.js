import test from "node:test";
import assert from "node:assert/strict";
import {
  createFeedback,
  reduceFeedback,
  captureSection,
  feedbackFiles,
  feedbackStatus,
} from "../src/feedback.ts";
import { buildPrompt } from "../src/prompt.ts";

const section = {
  id: "one",
  path: "src/run.ts",
  symbol: "@@ -10,2 +10,3 @@ run",
  lines: [
    { type: "remove", old: 10, new: null, text: "old" },
    { type: "add", old: null, new: 10, text: "new" },
    { type: "context", old: 11, new: 11, text: "context" },
  ],
};
const workspace = {
  version: "v1",
  repo: {
    path: "/work/project",
    branch: "main",
    name: "project",
    source: "git",
  },
  sections: [section],
  groups: [],
};
const comment = (id, path, text, intent = "change", anchor) => ({
  id,
  path,
  text,
  intent,
  ...(anchor ? { section: anchor } : {}),
});

test("feedback groups nonempty comments by file without repeating shared sections", () => {
  let state = createFeedback();
  for (const item of [
    comment("a", "src/run.ts", "Keep the wording.", "keep"),
    comment(
      "b",
      "src/run.ts",
      "Fix the result.",
      "change",
      captureSection(section, "v1"),
    ),
    comment("blank", "empty.ts", " \n "),
  ]) {
    state = reduceFeedback(state, { type: "add", comment: item });
  }
  assert.deepEqual(
    feedbackFiles(state).map((file) => [file.path, file.comments.length]),
    [["src/run.ts", 2]],
  );
  state = reduceFeedback(state, {
    type: "update",
    id: "a",
    patch: { text: "Keep the label.", intent: "note" },
  });
  assert.equal(state.comments[0].text, "Keep the label.");
  state = reduceFeedback(state, { type: "remove", id: "b" });
  assert.equal(feedbackFiles(state)[0].comments.length, 1);
});

test("legacy notes import once as contextual section comments and preserve captured ranges", () => {
  const state = createFeedback(undefined, workspace, {
    one: "Existing note",
    unknown: "Cannot locate",
  });
  assert.equal(state.comments.length, 1);
  assert.equal(state.comments[0].intent, "note");
  assert.deepEqual(state.comments[0].section, {
    id: "one",
    version: "v1",
    hunk: "@@ -10,2 +10,3 @@ run",
    oldRange: [10, 11],
    newRange: [10, 11],
  });
  const deleted = reduceFeedback(state, {
    type: "remove",
    id: state.comments[0].id,
  });
  assert.equal(
    createFeedback(JSON.parse(JSON.stringify(deleted)), workspace, {
      one: "Existing note",
    }).comments.length,
    0,
  );
});

test("captured references survive changed diffs and can be explicitly reassigned or made file-level", () => {
  const item = comment(
    "a",
    section.path,
    "Adjust this.",
    "change",
    captureSection(section, "v1"),
  );
  const changed = {
    ...workspace,
    version: "v2",
    sections: [{ ...section, id: "replacement" }],
  };
  assert.equal(feedbackStatus(item, workspace), "current");
  assert.equal(feedbackStatus(item, changed), "stale-section");
  assert.equal(
    feedbackStatus(item, { ...changed, sections: [] }),
    "missing-file",
  );
  let state = createFeedback({
    comments: [item],
    general: "Shared instructions",
  });
  state = reduceFeedback(state, {
    type: "update",
    id: "a",
    patch: { section: captureSection(changed.sections[0], "v2") },
  });
  assert.equal(feedbackStatus(state.comments[0], changed), "current");
  state = reduceFeedback(state, {
    type: "update",
    id: "a",
    patch: { section: undefined },
  });
  assert.equal(state.comments[0].section, undefined);
  assert.equal(state.general, "Shared instructions");
});

test("prompt exports only selected commented files with verbatim intent and captured references", () => {
  const state = createFeedback({
    general: "Use the existing tests.\nKeep this second line.",
    comments: [
      comment(
        "one",
        section.path,
        "Handle empty input.\n  Preserve indentation.",
        "change",
        captureSection(section, "v1"),
      ),
      comment("two", section.path, "The public name works.", "keep"),
      comment("three", section.path, "Called by the CLI.", "note"),
      comment("secret", "excluded.ts", "Do not export me."),
    ],
  });
  const prompt = buildPrompt(workspace, state, {
    paths: [section.path, section.path],
    includeGeneral: true,
  });
  assert.ok(prompt.includes("/work/project"));
  assert.ok(prompt.includes("Use the existing tests.\nKeep this second line."));
  assert.ok(prompt.includes("Handle empty input.\n  Preserve indentation."));
  assert.ok(prompt.includes("@@ -10,2 +10,3 @@ run"));
  assert.ok(prompt.includes("original L10–11; working L10–11"));
  assert.ok(
    prompt.includes("Keep") &&
      prompt.includes("Change") &&
      prompt.includes("Note"),
  );
  assert.equal(prompt.includes("excluded.ts"), false);
  assert.equal(prompt.includes("Do not export me"), false);
  assert.equal(prompt.match(/Handle empty input/g).length, 1);
  assert.equal(
    prompt,
    buildPrompt(workspace, state, {
      paths: [section.path],
      includeGeneral: true,
    }),
  );
});

test("general-only, file-only, and empty selections export independently, including stale warnings", () => {
  const state = createFeedback({
    general: "Tighten up the UI.",
    comments: [
      comment(
        "a",
        section.path,
        "Fix this.",
        "change",
        captureSection(section, "v1"),
      ),
    ],
  });
  const general = buildPrompt(workspace, state, {
    paths: [],
    includeGeneral: true,
  });
  assert.ok(general.includes("Tighten up the UI."));
  assert.equal(general.includes("src/run.ts"), false);
  const file = buildPrompt({ ...workspace, sections: [] }, state, {
    paths: [section.path],
    includeGeneral: false,
  });
  assert.equal(file.includes("Tighten up the UI."), false);
  assert.ok(
    file.includes("needs rechecking") &&
      file.includes("no longer in the current diff"),
  );
  assert.equal(
    buildPrompt(workspace, state, { paths: [], includeGeneral: false }),
    "",
  );
  assert.equal(
    buildPrompt(workspace, createFeedback({ general: " \n ", comments: [] }), {
      paths: [],
      includeGeneral: true,
    }),
    "",
  );
});

test("capturing a large section does not overflow the call stack", () => {
  const large = {
    ...section,
    lines: Array.from({ length: 150000 }, (_, i) => ({
      old: null,
      new: i + 1,
      type: "add",
      text: "",
    })),
  };
  assert.deepEqual(captureSection(large, "v1").newRange, [1, 150000]);
});
