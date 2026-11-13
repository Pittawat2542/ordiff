export function formatPrompt(workspace, files, general, feedbackStatus) {
  const intentLabels = { change: "Change", keep: "Keep", note: "Note" };
  const sectionReference = (section) =>
    [
      section.oldRange && `original ${range(section.oldRange)}`,
      section.newRange && `working ${range(section.newRange)}`,
    ]
      .filter(Boolean)
      .join("; ");
  const range = (value) =>
    `L${value[0]}${value[0] === value[1] ? "" : `–${value[1]}`}`;
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
      const context = comment.anchor
        ? `Captured ${comment.anchor.side} L${comment.anchor.startLine}–${comment.anchor.endLine}\n${comment.anchor.quote || ""}`
        : comment.section
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
