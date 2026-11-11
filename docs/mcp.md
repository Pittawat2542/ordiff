# Connect an agent to Ordiff

Ordiff includes a working local MCP stdio server built with the [official MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk). The agent reads the same Git diff shown in the app and sends back an ordered review path.

## Setup

1. Run `npm install`, then `npm run dev` in this checkout. The app and local API share port 5173.
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

Returns the selected repository, current diff version, existing groups, and the IDs, paths, roles, and hunk headers of its changed sections. It refreshes Git before responding.

- Set `includeDiff` to `true` to include code lines.
- Optionally pass `sectionIds` to read a smaller set of hunks.
- Large results require selecting fewer sections rather than silently truncating the code.

### `submit_review_plan`

Accepts the `version` from the current context and a `groups` array. Each group has an `id`, `title`, `description`, and ordered `steps`. Each step contains an existing `sectionId` and an `explanation` of why that section belongs here.

The app picks up the submitted plan automatically. Sections outside all groups stay visible as **Ungrouped changes**. A section may be referenced by several behaviors; its review progress is counted once overall.

The backend reads Git again before accepting a plan. A version mismatch or unknown section ID rejects the submission. Refreshing a changed diff removes stale grouping and starts fresh review progress for the new version.

## Local behavior

Git access is read-only: Ordiff does not stage, commit, discard, or change source files. The MCP tools do not mark sections reviewed or approve code. Only the human review interface changes review progress.

Repository selection and review plans are saved in the ignored `.ordiff/workspace.json` file. Review decisions, checklists, notes, and appearance are stored in the browser. **Close repository** returns the app to onboarding and clears its active server-side repository and plan.

The app reads combined working-tree changes against HEAD, including staged, unstaged, and non-ignored untracked files. Repositories without commits are supported. Binary files and oversized text files remain visible as sections requiring inspection in an editor. Use **Refresh diff** to pick up filesystem edits; the UI polls for newly submitted plans, not for continuous Git changes.

This version supports one selected local repository and a working-tree comparison. It does not provide GitHub PR access, revision selection, or a hosted repository service.

## Verification

`npm test` exercises real temporary Git repositories and a real stdio MCP handshake, tool discovery, diff retrieval, and plan submission into the same HTTP API used by the browser. Integration tests bind a loopback port.
