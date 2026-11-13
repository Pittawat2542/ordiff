import type { Workspace, WorkspaceResponse } from "../types";
export async function cycleRequest<T = unknown>(
  workspace: Workspace,
  action: string,
  input: Record<string, unknown> = {},
): Promise<WorkspaceResponse & { result: T }> {
  const response = await fetch("/api/cycle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repositoryId: workspace.repositoryId,
      comparisonId: workspace.comparisonId,
      action,
      input: { clientMutationId: crypto.randomUUID(), ...input },
    }),
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(
      new Error(data.message || data.error || "Could not save this change."),
      { status: response.status, current: data.current },
    );
  return data;
}
