import type { DiffLine, DiffSection, ReviewGroup } from "./types";

export const DIFF_VERSION = "pipeline-demo-v1";

export const groups: ReviewGroup[] = [
  {
    id: "failure-status",
    title: "Expose pipeline failure status",
    short: "Expose failure status",
    description:
      "Make failed pipeline runs visible, from the data contract to the interface.",
    icon: "status",
    sections: ["status-pipeline", "status-ui", "status-tests", "status-docs"],
  },
  {
    id: "retry-runs",
    title: "Retry failed pipeline runs",
    short: "Retry failed runs",
    description:
      "Let people recover a failed run, with a bounded retry policy and a clear action.",
    icon: "retry",
    sections: ["retry-pipeline", "retry-ui", "retry-tests"],
  },
  {
    id: "setup-guide",
    title: "Make local setup clearer",
    short: "Clarify local setup",
    description:
      "Give a new contributor a complete path from checkout to their first pipeline run.",
    icon: "book",
    sections: ["setup-docs"],
  },
];

function diff(start: number, rows: string[]): DiffLine[] {
  let oldLine = start;
  let newLine = start;
  return rows.map((row) => {
    const marker = row[0];
    const type: DiffLine["type"] =
      marker === "+" ? "add" : marker === "-" ? "remove" : "context";
    return {
      type,
      text: row.slice(1),
      old: type === "add" ? null : oldLine++,
      new: type === "remove" ? null : newLine++,
      extra: marker === "~",
    };
  });
}

export const sections: DiffSection[] = [
  {
    id: "status-pipeline",
    group: "failure-status",
    role: "Pipeline",
    path: "pipeline/serialize.ts",
    language: "TypeScript",
    symbol: "serializeRun",
    title: "Expose the full run status",
    subtitle: "The contract starts here",
    explanation:
      "The pipeline now returns an explicit status and an optional error message. This is the contract the interface will consume next.",
    connection: ["Pipeline state", "API response"],
    checklist: [
      "All terminal states are represented",
      "The error message is safe to expose",
    ],
    lines: diff(12, [
      '~import type { PipelineRun } from "./types";',
      "~",
      " export function serializeRun(run: PipelineRun) {",
      "   return {",
      "     id: run.id,",
      '-    completed: run.state === "completed",',
      "+    status: run.state,",
      "+    error: run.error?.message ?? null,",
      "   };",
      " }",
      "~",
      '~export const API_VERSION = "v2";',
    ]),
  },
  {
    id: "status-ui",
    group: "failure-status",
    role: "UI",
    path: "ui/RunStatus.tsx",
    language: "TSX",
    symbol: "RunStatus",
    title: "Give failure its own state",
    subtitle: "Consume the pipeline contract",
    explanation:
      "The UI now reads the status exposed by the pipeline. A failed run gets an explicit label instead of looking like it is still running.",
    connection: ["Pipeline output", "UI consumer"],
    checklist: [
      "Failure is distinct from running",
      "Other statuses still render correctly",
      "The label works without relying on color",
    ],
    lines: diff(28, [
      '~import { StatusBadge } from "./StatusBadge";',
      '~import type { Props } from "./types";',
      "~",
      " export function RunStatus({ run }: Props) {",
      "-  return <StatusBadge complete={run.completed} />;",
      "+  return <StatusBadge status={run.status} />;",
      " }",
      "~",
      "~export default RunStatus;",
    ]),
  },
  {
    id: "status-tests",
    group: "failure-status",
    role: "Tests",
    path: "tests/run-status.test.tsx",
    language: "TSX",
    symbol: "RunStatus › failed state",
    title: "Prove that failed runs look failed",
    subtitle: "Protect the behavior",
    explanation:
      "This regression test follows the same status field into the rendered interface. Check that it would fail if a failed run were shown as running.",
    connection: ["UI behavior", "Regression test"],
    checklist: [
      "The test starts with a failed run",
      "It checks what the user actually sees",
    ],
    lines: diff(18, [
      '~import { render, screen } from "@testing-library/react";',
      '~import { RunStatus } from "../ui/RunStatus";',
      "~",
      '-it("shows a completed run", () => {',
      "-  render(<RunStatus run={{ completed: true }} />);",
      '-  expect(screen.getByRole("status")).toHaveTextContent("Complete");',
      '+it("shows a failed run distinctly", () => {',
      '+  const run = { id: "run-42", status: "failed" };',
      "+  render(<RunStatus run={run} />);",
      '+  expect(screen.getByRole("status")).toHaveTextContent("Failed");',
      '+  expect(screen.queryByText("Running")).not.toBeInTheDocument();',
      " });",
    ]),
  },
  {
    id: "status-docs",
    group: "failure-status",
    role: "Docs",
    path: "docs/pipelines.md",
    language: "Markdown",
    symbol: "Run status",
    title: "Document the new contract",
    subtitle: "Close the loop",
    explanation:
      "The documentation should describe the same states exposed by the pipeline and shown in the UI. This completes the behavior, beyond the code.",
    connection: ["Implemented states", "Documented behavior"],
    checklist: [
      "The status values match the API",
      "Failure behavior is explained clearly",
    ],
    lines: diff(34, [
      "~## Monitoring a pipeline",
      "~",
      " ### Run status",
      " ",
      "-The `completed` flag indicates whether a run has finished.",
      "+Each run exposes a `status` field:",
      "+",
      "+- `running` — the pipeline is processing data.",
      "+- `completed` — every stage finished successfully.",
      "+- `failed` — a stage stopped with an error.",
      "+",
      "+Failed runs display a “Failed” badge in the run list.",
      "~",
      "~See the recovery guide for next steps.",
    ]),
  },
  {
    id: "retry-pipeline",
    group: "retry-runs",
    role: "Pipeline",
    path: "pipeline/retry.ts",
    language: "TypeScript",
    symbol: "retryRun",
    title: "Bound retries to failed runs",
    subtitle: "Recovery starts in the pipeline",
    explanation:
      "Only failed runs should be retried. The maximum attempt count prevents an unrecoverable run from looping indefinitely.",
    connection: ["Failed run", "Retry policy"],
    checklist: [
      "Successful runs cannot be retried",
      "The attempt limit is enforced",
    ],
    lines: diff(8, [
      "~const MAX_ATTEMPTS = 3;",
      "~",
      " export async function retryRun(run: PipelineRun) {",
      '+  if (run.status !== "failed") return run;',
      "+  if (run.attempts >= MAX_ATTEMPTS) {",
      '+    throw new Error("Retry limit reached");',
      "+  }",
      "+",
      "-  return enqueue(run);",
      "+  return enqueue({ ...run, attempts: run.attempts + 1 });",
      " }",
    ]),
  },
  {
    id: "retry-ui",
    group: "retry-runs",
    role: "UI",
    path: "ui/RunStatus.tsx",
    language: "TSX",
    symbol: "RunActions",
    title: "Offer a recovery action",
    subtitle: "A second behavior in the same file",
    explanation:
      "This is a different section of the same UI file you saw earlier. The retry action belongs to recovery, so it appears in this behavior rather than the status-label walkthrough.",
    connection: ["Retry policy", "Recovery action"],
    checklist: [
      "Retry is offered only on failure",
      "The action is disabled while retrying",
    ],
    lines: diff(63, [
      '~import { retryRun } from "../api/runs";',
      "~",
      " export function RunActions({ run }: Props) {",
      "   const { retry, isPending } = useRetry(run.id);",
      "+",
      '+  if (run.status !== "failed") return null;',
      " ",
      "   return (",
      "-    <span>No actions available</span>",
      "+    <Button onClick={retry} disabled={isPending}>",
      '+      {isPending ? "Retrying…" : "Retry run"}',
      "+    </Button>",
      "   );",
      " }",
    ]),
  },
  {
    id: "retry-tests",
    group: "retry-runs",
    role: "Tests",
    path: "tests/retry.test.ts",
    language: "TypeScript",
    symbol: "retryRun › attempt limit",
    title: "Catch an endless retry loop",
    subtitle: "Verify the boundary",
    explanation:
      "The boundary test exercises the maximum attempt count. An off-by-one change to the retry policy should be caught here.",
    connection: ["Attempt limit", "Boundary test"],
    checklist: [
      "The attempt count is at the limit",
      "No additional run is enqueued",
    ],
    lines: diff(21, [
      '~describe("retryRun", () => {',
      '+  it("stops after three attempts", async () => {',
      "+    const run = failedRun({ attempts: 3 });",
      "+",
      "+    await expect(retryRun(run)).rejects.toThrow(",
      '+      "Retry limit reached",',
      "+    );",
      "+    expect(queue.pending()).toHaveLength(0);",
      "+  });",
      "~});",
    ]),
  },
  {
    id: "setup-docs",
    group: "setup-guide",
    role: "Docs",
    path: "docs/development.md",
    language: "Markdown",
    symbol: "Local development",
    title: "Make the first run reproducible",
    subtitle: "A complete setup sequence",
    explanation:
      "The setup guide now includes the environment file and a seed command. Check the sequence from a clean checkout rather than assuming an existing local setup.",
    connection: ["Clean checkout", "First pipeline run"],
    checklist: [
      "Commands work from a clean checkout",
      "The environment example is documented",
    ],
    lines: diff(6, [
      " ## Local development",
      " ",
      " ```sh",
      " npm install",
      "+cp .env.example .env.local",
      "+npm run db:seed",
      " npm run dev",
      " ```",
      "+",
      "+Open the pipeline workspace and run the sample import.",
    ]),
  },
  {
    id: "ungrouped-config",
    group: null,
    role: "Config",
    path: ".env.example",
    language: "Environment",
    symbol: "Logging configuration",
    title: "Change the default log level",
    subtitle: "Outside the proposed review path",
    explanation:
      "The agent did not assign this change to a behavior. It still needs your attention: changing the default logging level can affect local debugging.",
    connection: ["Unassigned change", "Your review"],
    checklist: [
      "The new default is intentional",
      "Debugging remains practical",
    ],
    lines: diff(4, [
      " PIPELINE_PORT=4000",
      "-LOG_LEVEL=debug",
      "+LOG_LEVEL=info",
      " RETRY_LIMIT=3",
    ]),
  },
  {
    id: "ungrouped-readme",
    group: null,
    role: "Docs",
    path: "README.md",
    language: "Markdown",
    symbol: "Project links",
    title: "Update a documentation link",
    subtitle: "Outside the proposed review path",
    explanation:
      "This link change is not part of a proposed behavior. A complete review includes these small changes as well as the guided narrative.",
    connection: ["Unassigned change", "Your review"],
    checklist: ["The link points to the intended guide"],
    lines: diff(12, [
      " ## Documentation",
      " ",
      "-Read [the wiki](./wiki/index.md) for setup instructions.",
      "+Read [the development guide](./docs/development.md) to get started.",
    ]),
  },
];

export const sectionById = Object.fromEntries(
  sections.map((section) => [section.id, section]),
);
export const groupById = Object.fromEntries(
  groups.map((group) => [group.id, group]),
);
export const guidedOrder = groups.flatMap((group) => group.sections);

export function changeCounts(items: DiffSection[]) {
  return items.reduce(
    (counts, section) => {
      for (const line of section.lines || []) {
        if (line.type === "add") counts.add++;
        if (line.type === "remove") counts.remove++;
      }
      return counts;
    },
    { add: 0, remove: 0 },
  );
}
