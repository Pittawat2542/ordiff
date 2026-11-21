import { createContext } from "react";
import type { Workspace } from "../types";

export function reviewScope(
  workspace: Pick<Workspace, "repositoryId" | "comparisonId">,
) {
  if (!workspace.repositoryId || !workspace.comparisonId) return "";
  return new URLSearchParams({
    repositoryId: workspace.repositoryId,
    comparisonId: workspace.comparisonId,
  }).toString();
}

export const ReviewScope = createContext("");
