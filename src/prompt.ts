import {
  feedbackFiles,
  feedbackStatus,
  intentLabels,
  sectionReference,
} from "./feedback";
import type { FeedbackState, Workspace } from "./types";

export function buildPrompt(
  workspace: Workspace,
  state: FeedbackState,
  selection: { paths: string[]; includeGeneral: boolean },
) {
  const files = feedbackFiles(state).filter((file) =>
    selection.paths.includes(file.path),
  );
  const general =
    selection.includeGeneral && state.general.trim() ? state.general : "";
  if (!files.length && !general) return "";
  const parts = [
    "# Review feedback",
    "Apply the requested changes below. Preserve the behavior described under Keep; use Note comments as context. Follow the general instructions where provided. Inspect the current files before editing, run relevant checks, and summarize the changes.",
    `Repository: ${workspace.repo.path}\nBranch: ${workspace.repo.branch}`,
  ];
  if (general) parts.push(`## General instructions\n\n${general}`);
  for (const file of files) {
    parts.push(`## File: ${file.path}`);
    for (const comment of file.comments) {
      const status = feedbackStatus(comment, workspace);
      const context = comment.section
        ? `Section: ${comment.section.hunk}${sectionReference(comment.section) ? `\nLines: ${sectionReference(comment.section)}` : ""}`
        : "Whole file";
      const warning =
        status === "current"
          ? ""
          : `\nReference needs rechecking: ${status === "missing-file" ? "file is no longer in the current diff" : "section is no longer in the current diff"}.${comment.section ? ` Captured from diff ${comment.section.version}.` : ""}`;
      parts.push(
        `### ${intentLabels[comment.intent]}\n\n${context}${warning}\n\n${comment.text}`,
      );
    }
  }
  return parts.join("\n\n") + "\n";
}
