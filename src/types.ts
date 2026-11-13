import type { z } from "zod";
import type { comparisonSchema, anchorSchema, feedbackCommentSchema, decisionSchema, fileSourceSchema } from "../shared/contracts.js";
export type ComparisonSpec = z.infer<typeof comparisonSchema>;
export type FeedbackAnchor = z.infer<typeof anchorSchema>;
export type Theme = "light" | "dark";
export type ReviewView =
  "behavior" | "all" | "ungrouped" | "deferred" | "since";
export type ReviewFilter = "all" | "reviewed" | "unreviewed" | "deferred";
export type ReviewStatus = "clean" | "complete" | "reviewing";

export type FeedbackIntent = "change" | "keep" | "note";
export interface FeedbackSection {
  id: string;
  version: string;
  hunk: string;
  oldRange?: [number, number];
  newRange?: [number, number];
}
export type FeedbackComment = z.infer<typeof feedbackCommentSchema>;
export type FileSource = z.infer<typeof fileSourceSchema>;
export interface FeedbackState {
  comments: FeedbackComment[];
  general: string;
}
export type FeedbackAction =
  | { type: "add"; comment: FeedbackComment }
  | {
      type: "update";
      id: string;
      patch: Partial<
        Pick<
          FeedbackComment,
          "text" | "intent" | "section" | "anchor" | "status"
        >
      >;
    }
  | { type: "remove"; id: string }
  | { type: "general"; text: string };

export type PreviewKind =
  | "image"
  | "pdf"
  | "word"
  | "word-doc"
  | "spreadsheet"
  | "csv"
  | "markdown"
  | "audio"
  | "video"
  | "unsupported";
export interface FileRevision {
  size: number;
  hash: string;
}
export interface FilePreview {
  kind: PreviewKind;
  mimeType: string;
  before: FileRevision | null;
  after: FileRevision | null;
  base?: string | null;
}

export interface DiffLine {
  type: "add" | "remove" | "context";
  text: string;
  old: number | null;
  new: number | null;
  extra?: boolean;
}

export interface DiffSection {
  fileId?: string;
  id: string;
  path: string;
  role: string;
  language?: string;
  symbol?: string;
  title?: string;
  explanation?: string;
  group?: string | null;
  checklist?: string[];
  lines?: DiffLine[];
  binary?: boolean;
  file?: FilePreview;
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
  snapshotId?: string;
  repositoryId?: string;
  comparisonId?: string;
  comparison?: ComparisonSpec;
  resolved?: { before: string; after: string | null };
  files?: {
    id: string;
    path: string;
    beforeTextAvailable?: boolean;
    afterTextAvailable?: boolean;
  }[];
  cycle?: ReviewCycle;

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
  deferred?: string[];
  pathFilter?: string;
  changeFilter?: string;
  feedbackOnly?: boolean;
  notes: Record<string, string>;
  checks: Record<string, number[]>;
  theme: Theme;
  query: string;
  filter: ReviewFilter;
  revisit: boolean;
}

export type ReviewAction =
  | { type: "defer"; id: string }
  | {
      type: "facets";
      pathFilter?: string;
      changeFilter?: string;
      feedbackOnly?: boolean;
    }
  | { type: "group" | "section"; id: string }
  | { type: "set-reviewed"; id: string; reviewed: boolean }
  | { type: "view"; view: ReviewView }
  | { type: "note"; id: string; text: string }
  | { type: "check"; id: string; index: number }
  | { type: "next" | "previous" }
  | { type: "search"; query: string }
  | { type: "filter"; filter: ReviewFilter };

export interface McpConfig {
  mcpServers: Record<
    string,
    { command: string; args: string[]; env: Record<string, string> }
  >;
}

export interface RecentRepository {
  name: string;
  path: string;
}

export interface DirectoryListing {
  path: string;
  parentPath: string | null;
  homePath: string;
  breadcrumbs: { name: string; path: string }[];
  directories: { name: string; path: string }[];
}

export interface WorkspaceResponse {
  revision: number;
  workspace: Workspace | null;
  unchanged?: boolean;
  defaultPath?: string;
  mcpConfig?: McpConfig | null;
  recentRepositories?: RecentRepository[];
}

export type CycleDecision = z.infer<typeof decisionSchema>;
export interface ReviewCycle {
  pass: {
    id: string;
    snapshotId: string;
    previousPassId: string | null;
    createdAt: string;
    decisions: Record<string, CycleDecision>;
    checks: Record<string, number[]>;
    checksRevision?: number;
    planRevision: number;
    groups: ReviewGroup[];
    planHistory: { revision: number; groups: ReviewGroup[] }[];
  };
  feedback: FeedbackState & { revision: number };
  history: {
    id: string;
    snapshotId: string;
    createdAt: string;
    reviewed: number;
    available: boolean;
  }[];
  changes: {
    matches: Record<
      string,
      { previousId: string; kind: "unchanged" | "modified" }
    >;
    removed: { id: string; path: string; symbol: string }[];
  };
  previousDecisions: Record<string, CycleDecision>;
  latestSnapshotId: string;
  proposals: {
    id: string;
    snapshotId: string;
    groups: ReviewGroup[];
    status: string;
    expectedPlanRevision: number;
  }[];
  reports: {
    id: string;
    commentId: string;
    commentRevision: number;
    outcome: string;
    explanation: string;
    snapshotId: string;
  }[];
  batches: { id: string; status: string; count: number; createdAt: string }[];
  storage: { bytes: number; snapshots: number };
}
