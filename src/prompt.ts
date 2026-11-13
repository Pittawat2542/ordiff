import { formatPrompt } from "../shared/prompt.js";
import { feedbackFiles, feedbackStatus } from "./feedback";
import type { FeedbackState, Workspace } from "./types";

export function buildPrompt(
  workspace: Workspace,
  state: FeedbackState,
  selection: {
    paths: string[];
    includeGeneral: boolean;
    includeResolved?: boolean;
  },
) {
  const files = feedbackFiles({
    ...state,
    comments: state.comments.filter(
      (c) => selection.includeResolved || c.status !== "resolved",
    ),
  }).filter((file) => selection.paths.includes(file.path));
  const general =
    selection.includeGeneral && state.general.trim() ? state.general : "";
  return formatPrompt(workspace, files, general, feedbackStatus);
}
