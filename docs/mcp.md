# Connect an agent to Ordiff

Ordiff's local MCP stdio server lets an agent capture a fresh snapshot independently of the diff displayed in the app and propose an ordered review path. It uses the official MCP TypeScript SDK. Human review decisions remain in the interface.

## Setup

For the installed macOS app, open Ordiff and use **Connect agent** to copy its configuration. It references the bundled Node executable and MCP module in `Ordiff.app`, with `ORDIFF_URL=http://127.0.0.1:47831`. Keep at least one Ordiff window open (minimized is fine). Closing the last window stops the backend; tool calls then ask you to reopen Ordiff. Moving the app requires copying its configuration again.

For browser development:

1. With Node.js 22.13 or later and Git installed, run `npm install`, then `npm run dev` in this checkout. The app and local API share port 5173. A built app started with `npm run preview` supports the same API.
2. Open a local repository in Ordiff.
3. Click **Connect agent** in the toolbar and copy the configuration into your MCP client. The dialog contains the exact Node executable and server path for this machine.
4. Ask the agent: “Read the current Ordiff diff. Group the changes by behavior and submit a review plan with a useful reading order and grounded explanations.”

The configuration follows this shape. Replace the example paths with the exact values from the app:

```json
{
  "mcpServers": {
    "ordiff": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/ordiff-ui/server/mcp.js"],
      "env": {
        "ORDIFF_URL": "http://127.0.0.1:5173"
      }
    }
  }
}
```

Client configuration formats differ; use these command, arguments, and environment values in your client's MCP settings. No API key is required. Keep the Ordiff app running while the agent uses its tools. The client launches the stdio server; there is no remote MCP endpoint to publish.

## Tools

### `get_review_context`

Captures fresh local Git contents without activating a human review pass. Returns `repositoryId`, `comparisonId`, `snapshotId`, the compatible `version` alias, resolved revisions, visible snapshot ID, and section metadata. Pass `snapshotId` on subsequent calls to read the exact captured snapshot. The active review, progress, scroll position, and drafts remain unchanged.

`includeDiff` and `includePlan` default to false. Pass up to 100 `sectionIds` to retrieve a subset. Responses are bounded to 2 MiB: read metadata first and request fewer sections if needed. Binary sections contain descriptions, not bytes. Retained source has a renewable 30-minute capture lease; historical payloads may later be evicted.

### `submit_review_plan`

Pass the captured `version` and ordered groups:

```json
{
  "version": "<captured snapshot ID>",
  "groups": [{
    "title": "Prevent empty tasks",
    "description": "Validation and its consumers",
    "sections": ["<section ID>"],
    "explanations": {"<section ID>": "Check the empty input path."}
  }]
}
```

Groups contain 1–500 section references; there may be 1–100 groups. Titles are limited to 160 characters, descriptions to 1,000, explanations to 2,000. Explanations must reference sections in their group. IDs are validated against the captured snapshot, without refreshing Git. Identical submissions are idempotent.

A plan applies immediately only when it targets the visible snapshot and no plan exists. Otherwise it becomes a proposal for human preview and acceptance. Replacement plans retain review decisions, comments, and previous plan revisions. Sections can appear in multiple groups but count once; uncovered sections remain visible. Agents cannot accept proposals or mark sections reviewed.

### `list_feedback_batches`

Lists published, non-revoked batch metadata for the selected comparison. Unpublished comments and draft text are not exposed.

### `get_feedback_batch`

Reads a published batch by ID, including immutable selected comment revisions, original anchors, general instructions, and snapshot references. Edits or deletion of the source comments do not change this batch. Revocation blocks future retrieval; it cannot erase an agent's earlier read.

### `report_feedback_outcomes`

Records `addressed`, `not-addressed`, or `needs-clarification` with an explanation, inspected snapshot ID, and published comment revision. Use the tool's advertised input schema for the report envelope. Retrying the same mutation is idempotent. Addressed reports update only the matching current comment revision. Reports against earlier revisions remain historical. Only a human can resolve feedback.

## Human handoff

1. Write file, section, or selected-line comments. Intent (Change/Keep/Note) is independent of status (Open/Addressed/Resolved).
2. Open **Build prompt**, choose files and general instructions, then explicitly publish the MCP batch. Open and Addressed feedback is selected by default; Resolved is opt-in.
3. Copy the instruction containing the batch ID into your agent. Ordiff does not launch or message the agent.
4. After the agent reports outcomes, inspect current code and resolve or reopen comments in the feedback panel.
5. When **Changes available** appears, choose **Review update** to activate the captured snapshot and begin a new pass. Unchanged previously reviewed sections still need confirmation.

## Local behavior and limits

Git remains read-only. Comparisons support working changes (including staged, unstaged, and non-ignored untracked files), branch merge-base comparisons, and exact commit comparisons. Remote-tracking refs must already exist locally: Ordiff never fetches. Multiple or missing merge bases require an explicit commit comparison.

A visible review client enables shared background detection: lightweight checks every five seconds and full verification no more than once a minute, with backoff. Hidden or disconnected clients stop detection. New contents are announced, never automatically activated. Reconnect resynchronizes resource state.

Review data lives under `.ordiff/reviews/` in development and `~/Library/Application Support/Ordiff/reviews/` on desktop. Workspace selection remains in `workspace.json`. Sample reviews stay isolated in browser storage. See [storage and recovery](development.md#review-storage-and-recovery).

All access remains loopback and same-origin. `ORDIFF_URL` must use HTTP with `127.0.0.1`, `localhost`, or `[::1]`. Snapshot capture is limited to 500 changed files, 2 MiB full text per file, and 64 MiB full text per snapshot. Larger files retain supported diff/preview fallbacks with explicit availability messages.

## Verification

`npm test` exercises temporary Git repositories, persistence and conflicts, a real stdio MCP handshake, fresh context without activation, plan proposals, immutable batches, and outcome reports. Integration tests bind a loopback port. See [the development guide](development.md#verification).
