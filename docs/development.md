# Developing Ordiff

Ordiff uses React, TypeScript, Vite, Tailwind CSS, and locally owned shadcn/ui controls. The Git API and MCP server are Node.js modules. Install dependencies with `npm install`; Node.js 22.13 or later and Git must be available.

## Source layout

| Location                                   | Responsibility                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `src/App.tsx`                              | Workspace composition, dialogs, keyboard shortcuts, and drawer focus                                    |
| `src/hooks/use-review.ts`                  | Workspace requests, revision subscriptions, browser persistence, explicit review decisions, advancement, and Undo |
| `src/review.ts`                            | Dataset-independent review state, navigation, search, filtering, and progress                           |
| `src/feedback.ts`, `src/prompt.ts`          | Feedback state, captured references, legacy-note import, and deterministic selected-prompt generation  |
| `src/hooks/use-feedback.ts`                | Repository-scoped browser feedback persistence, independent of diff-versioned review progress          |
| `src/sample-data.ts`                       | The built-in example review; separate from repository parsing and the review model                      |
| `src/types.ts`                             | Frontend data contracts                                                                                 |
| `src/diff-view.tsx`                        | Unified diff, preview tabs, and original/working comparison panes                                       |
| `src/lib/diff.ts`, `src/lib/highlight.ts`  | Change counts and language-aware highlighting                                                           |
| `src/components/`                          | Navigation, review content, footer, dialogs, and file viewers                                           |
| `src/components/ui/`                       | Shared button, input, and textarea controls                                                             |
| `src/style.css`, `src/preview.css`, `src/feedback.css` | App themes, layout, accessibility, previews, feedback panels, and prompt builder                              |
| `server/git.js`                            | Read-only Git snapshots and independently identified hunks                                              |
| `server/files.js`, `server/word-worker.js` | Snapshot-authorized file access, Markdown images, and DOC text extraction                               |
| `server/workspace.js`                      | Serialized repository and plan operations, validation, and disk persistence                             |
| `server/api.js`                            | Loopback HTTP interface shared by development and production preview                                    |
| `server/mcp.js`, `server/schema.js`        | Stdio tools and review-plan schema                                                                      |

## Rendering

Source diffs use Lowlight grammars, with original and working streams highlighted independently so multiline syntax does not leak between revisions. Markdown uses react-markdown and remark-gfm; raw HTML is omitted, relative images are authorized through the local API, and external images do not load automatically.

PDFs use react-pdf and PDF.js. Vite bundles the matching worker and serves cMaps, standard fonts, and WebAssembly assets locally. Keep these assets aligned with the installed PDF.js version. The viewer disables document-level Suspense so its binary input stays mounted during loading; callbacks handle errors and password-protected files.

DOCX conversion uses Mammoth, with embedded style maps and external-file access disabled. The resulting HTML passes through the browser Sanitizer API where available, with DOMPurify as a fallback. Only supported embedded raster images are retained. XLSX uses ExcelJS, CSV uses Papa Parse, and DOC text uses word-extractor. DOCX and XLSX parsing run in browser workers; DOC extraction runs in a bounded Node worker. Parsers and PDF rendering load on demand. Images and audio/video use native browser rendering.

Comparison panes load and retry independently. Preserve those boundaries when changing viewers so a failed revision does not replace the other pane's contents or controls.

## Local interfaces and persistence

The workspace API publishes typed SSE events with a monotonic workspace revision and resource identity. A shared detector runs only for visible subscribed clients, checks metadata every five seconds, and performs full verification at most once per minute. Candidate snapshots never activate themselves. Clients refetch durable state on reconnect; events are hints, not the source of truth.

`server/review-store.js` owns snapshots, comparison-scoped passes, comments, batches, reports, and plan revisions. `server/cycle-api.js` exposes resource endpoints and the transitional `/api/cycle` adapter. `shared/contracts.js` supplies Zod validation and inferred frontend types. Snapshot capture and Git resolution stay in `server/git.js`; source serving stays in `server/files.js`. The standalone text utility sends no text to these endpoints.

The shared repository chooser is in `src/components/repository-chooser.tsx`. Full workspace responses and mutation responses include `recentRepositories: { name, path }[]`. The workspace store persists up to ten canonical repository roots alongside `path` and `plan`; explicit successful opens update recency, while restoration does not. Legacy state seeds history from an accessible active repository. `POST /api/recent-repositories/remove` accepts `{ path }`, persists removal, and publishes a revision without changing the active review or plan. Client history updates use the same request-generation guard as workspace selection.

`GET /api/directories?path=…&showHidden=true` returns `{ path, parentPath, homePath, breadcrumbs, directories }`. Breadcrumbs and directories contain `{ name, path }`; paths are absolute, and `parentPath` is null at the filesystem root. The endpoint reads one directory level, sorts folders by name, includes directory symlinks, and omits hidden folders unless requested. An omitted path uses the home directory; `~` and `~/…` are supported. Directory requests use the same loopback and same-origin checks as repository requests, never invoke Git, and never change workspace state. The chooser cancels superseded requests and falls back home if its initial folder is inaccessible.

Desktop browsing invokes the Rust `pick_repository_directory` command through `@tauri-apps/api/core`. Its explicit capability grants only that command to the main window at `http://127.0.0.1:47831/`; the command also validates the window and origin, permits only one native picker at a time, and returns one path or null on cancellation. The text-diff window has no picker capability. The selected directory then uses the existing HTTP repository connection flow. No JavaScript filesystem or shell permissions are granted.

File requests identify an authorized `sectionId`, exact `version`, and `side` (`before` or `after`). DOC text uses `format=text`; Markdown images use `resource` and must be referenced by that document. Original bytes come from the snapshot's Git blobs; working bytes must match the snapshot's hashes. Requests reject stale versions, changed bytes, symlink targets, paths outside the repository, and cross-origin access. File responses use attachment, no-store, and sandbox headers.

## Review storage and recovery

The versioned workspace document records selection and recent repositories. Per-repository metadata and content-addressed source payloads live in `reviews/` beside it. Separate worktree roots have separate identities. The backend serializes mutations, writes source payloads first, atomically replaces metadata, and acknowledges only after persistence. A process ownership lock prevents concurrent writers to one data root. Unsupported schema versions are rejected instead of overwritten.

New snapshots and active displayed content are pinned; captured snapshots receive a 30-minute renewable lease. Default retention keeps ten unpinned snapshots, with a 512 MiB historical content budget, 64 MiB full text per snapshot, and 2 MiB per file. Storage pressure or unavailable historical content produces an explicit error. Review records, captured quotes, and published batches survive source-payload eviction. **Review storage** can clear historical source or delete repository review data after typing the repository name.

Legacy browser feedback and review keys import once, using an installation ID and digest. Existing keys remain rollback backups. Empty feedback records prevent old notes from being resurrected. Matching progress imports into the active pass; mismatched progress remains legacy history. Quick notes now use the feedback model.

Appearance and navigation stay local to each client. Comment edits debounce for 400 ms and flush on blur. A local `.draft` outbox retains exact expected revisions and pending text until server acknowledgement. On conflict, **Use latest** discards the pending edit; **Save as another comment** preserves it separately. Retrying never silently overwrites another window's newer record. Keep the original browser profile when recovering unsent drafts.

Back up `workspace.json`, `reviews/`, and the browser profile while Ordiff is stopped. Migration preserves legacy workspace backups. Restore the data root as a unit, using a compatible application version; never edit the metadata while its backend owns the lock. Development and desktop roots remain separate.

Resource mutations carry explicit IDs and optimistic revisions. Error responses identify conflicts (409), evicted source (410), limits (413), or invalid comparison selections (422). Legacy `/api/file`, workspace, and plan adapters remain for compatibility; new integrations should use snapshot-bound resources and MCP proposals.

Text pages and lists are bounded. Diff display pages mount at most 500 canonical rows, full-file pages request 200 lines, and word highlighting runs in a worker with workload limits. Whitespace hiding changes presentation only. Selected ranges keep revision side and inclusive source coordinates, with limits of 100 lines and 16 KiB captured quote/context. Original anchors remain available after reassignment.

## Verification

| Command             | Coverage                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck` | Strict TypeScript, including unused locals and parameters                                                           |
| `npm run test:core` | Review state, real temporary Git repositories, local file/API behavior, persistence, and a real MCP stdio handshake |
| `npm run test:ui`   | React interactions, navigation, review progression, Undo, preview modes, comparison panes, and error recovery       |
| `npm test`          | Both test suites                                                                                                    |
| `npm run build`     | Type checking and production bundles, workers, fonts, and PDF assets                                                |
| `npm run preview`   | Production build with the same local API                                                                            |

Integration tests bind loopback ports and launch Git and Node workers. Browser checks should cover both appearances, desktop and drawer layouts, keyboard focus, long paths, empty and completed reviews, stale plans, and failed previews. For comparison changes, inspect both revisions and ensure zoom, page navigation, worksheet selection, downloads, and retries remain scoped to their pane.

### Review-cycle validation record

The upgrade passed 75 core tests, 96 UI tests, TypeScript checking, the production build, macOS bundle compilation/signing, and the signed-bundle Git/MCP runtime test. Scale fixtures cover 500 changed files (and explicit rejection of file 501), a 20,000-line capture, and 1,000 comments in a published batch. These are functional workload checks, not a latency guarantee.

Browser checks exercised durable line comments, reload, full-file context, explicit batch publication, manual behavior saving, both themes, and layouts at 390, 768, 1024, 1280, and 1440 px. The sample includes an isolated illustrative walkthrough rather than publishing demonstration batches to a real backend.

Manual release checks still include VoiceOver, physical sleep/wake, reduced-motion interaction, and fresh energy measurements. The compatibility workspace response still includes full review metadata; resource text reads and the new collection routes are bounded. Global storage accounting is conservative: when another repository consumes the budget, cleanup may require opening that repository and clearing its historical source. Source metadata and review records remain intact. Do not describe these checks as a completed performance or accessibility certification.
