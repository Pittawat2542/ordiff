export type Theme = "light" | "dark";
export type ReviewView = "behavior" | "all" | "ungrouped";
export type ReviewFilter = "all" | "reviewed" | "unreviewed";
export type ReviewStatus = "clean" | "complete" | "reviewing";

export interface DiffLine {
  type: "add" | "remove" | "context";
  text: string;
  old: number | null;
  new: number | null;
  extra?: boolean;
}

export interface DiffSection {
  id: string;
  path: string;
  role: string;
  language?: string;
  symbol?: string;
  title?: string;
  subtitle?: string;
  explanation?: string;
  connection?: string[];
  group?: string | null;
  checklist?: string[];
  lines?: DiffLine[];
  binary?: boolean;
}

export interface ReviewSection extends DiffSection {
  group: string | null;
  checklist: string[];
  lines: DiffLine[];
}

export interface ReviewGroup {
  id: string;
  title: string;
  description: string;
  short?: string;
  icon?: string;
  sections: string[];
  explanations?: Record<string, string>;
}

export interface ReviewDataset {
  version: string;
  groups: ReviewGroup[];
  sections: DiffSection[];
}

export interface Workspace extends ReviewDataset {
  repo: {
    name: string;
    path: string;
    branch: string;
    source: "demo" | "git";
    hasHead?: boolean;
  };
  planStatus: "sample" | "none" | "current" | "stale";
}

export interface ReviewState {
  version: string;
  view: ReviewView;
  groupId: string | null;
  activeId: string | null;
  reviewed: string[];
  notes: Record<string, string>;
  checks: Record<string, number[]>;
  theme: Theme;
  query: string;
  filter: ReviewFilter;
  revisit: boolean;
}

export type ReviewAction =
  | { type: "group" | "section" | "review"; id: string }
  | { type: "view"; view: ReviewView }
  | { type: "note"; id: string; text: string }
  | { type: "check"; id: string; index: number }
  | { type: "next" | "previous" | "theme" }
  | { type: "search"; query: string }
  | { type: "filter"; filter: ReviewFilter };

export interface McpConfig {
  mcpServers: Record<
    string,
    { command: string; args: string[]; env: Record<string, string> }
  >;
}

export interface WorkspaceResponse {
  revision: number;
  workspace: Workspace | null;
  unchanged?: boolean;
  defaultPath?: string;
  mcpConfig?: McpConfig | null;
}
