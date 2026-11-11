# Connect an agent to Ordiff

Ordiff's local MCP stdio server lets an agent read the same Git diff shown in the app and propose an ordered review path. It uses the official MCP TypeScript SDK. Human review decisions remain in the interface.

## Setup

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

Returns the selected repository, current diff version, plan status, existing groups, and the IDs, paths, roles, hunk headers, and binary flags of its changed sections. It refreshes Git before responding.

- `includeDiff` defaults to `false`; set it to `true` to include code lines.
- Optionally pass up to 100 `sectionIds` to read a smaller set of hunks. Unknown or stale IDs are rejected.
- Results larger than 2 MiB are rejected rather than silently truncated. Read metadata first, then request smaller sets of sections.
- Binary sections include a description, not their file bytes. The app's local viewers provide original/working previews and downloads.

### `submit_review_plan`

Accepts the `version` from the current context and a `groups` array. Each group has an `id`, `title`, `description`, and ordered `steps`. Each step contains an existing `sectionId` and an `explanation` of why that section belongs here.

Plans contain 1–100 groups, each with 1–500 steps. Group IDs are unique simple names of 1–80 letters, digits, underscores, or hyphens. Titles are 1–160 characters, descriptions up to 1,000 characters, and step explanations up to 2,000 characters. A group cannot repeat a section.

The app picks up the submitted plan automatically. Sections outside all groups stay visible as **Ungrouped changes**. A section may be referenced by several behaviors; its review progress is counted once overall.

The backend reads Git again before accepting a plan. A version mismatch or unknown section ID rejects the submission. Refreshing a changed diff removes stale grouping and starts fresh review progress for the new version. Binary content changes participate in versioning, including edits that leave the file size unchanged.

Submit grounded explanations and use IDs returned by `get_review_context`; never infer IDs from paths or assume that one file is one section. The response reports the accepted behavior count, covered-section count, and remaining unassigned-section count. The interface picks up the plan automatically.

## Local behavior

Git access is read-only: Ordiff does not stage, commit, discard, or change source files. The MCP tools do not mark sections reviewed or approve code. Only the human review interface changes review progress.

Repository selection and review plans are saved in the app checkout's ignored `.ordiff/workspace.json` file. Review decisions, checklists, notes, and appearance are stored in the browser. **Close repository** returns the app to onboarding and clears its active server-side repository and plan. Sample reviews do not connect a repository for MCP access.

The app reads combined working-tree changes against HEAD, including staged, unstaged, and non-ignored untracked files. Repositories without commits are supported. Changed binary files show original and working previews side by side for supported formats; unsupported files retain a fallback. Preview limits and supported formats are in [the README](../README.md#preview-files).

Use **Refresh diff** to pick up filesystem edits; the UI polls for newly submitted plans, not for continuous Git changes. Git snapshots are limited to 500 changed files. All API and MCP access stays on loopback; `ORDIFF_URL` must use HTTP and `127.0.0.1`, `localhost`, or `[::1]`.

This version supports one selected local repository and a working-tree comparison. It does not provide GitHub PR access, revision selection, or a hosted repository service.

## Verification

`npm test` exercises real temporary Git repositories and a real stdio MCP handshake, tool discovery, diff retrieval, and plan submission into the same HTTP API used by the browser. Integration tests bind a loopback port. See [the development guide](development.md#verification) for the complete checks.
