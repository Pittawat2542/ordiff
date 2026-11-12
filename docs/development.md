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

The workspace API serves the selected repository and a revision counter. `GET /api/events` opens a same-origin SSE stream, sends the current `{ revision }`, then sends revisions after persisted workspace mutations. Streams have no heartbeat and never read Git. The client fetches a snapshot when the revision changes, closes its stream while hidden or in sample mode, and resynchronizes on return. Failed streams reconnect with exponential backoff capped at 60 seconds while visible. Refresh explicitly after filesystem edits. MCP context retrieval and plan submission also refresh Git before operating.

The shared repository chooser is in `src/components/repository-chooser.tsx`. Full workspace responses and mutation responses include `recentRepositories: { name, path }[]`. The workspace store persists up to ten canonical repository roots alongside `path` and `plan`; explicit successful opens update recency, while restoration does not. Legacy state seeds history from an accessible active repository. `POST /api/recent-repositories/remove` accepts `{ path }`, persists removal, and publishes a revision without changing the active review or plan. Client history updates use the same request-generation guard as workspace selection.

`GET /api/directories?path=…&showHidden=true` returns `{ path, parentPath, homePath, breadcrumbs, directories }`. Breadcrumbs and directories contain `{ name, path }`; paths are absolute, and `parentPath` is null at the filesystem root. The endpoint reads one directory level, sorts folders by name, includes directory symlinks, and omits hidden folders unless requested. An omitted path uses the home directory; `~` and `~/…` are supported. Directory requests use the same loopback and same-origin checks as repository requests, never invoke Git, and never change workspace state. The chooser cancels superseded requests and falls back home if its initial folder is inaccessible.

Desktop browsing invokes the Rust `pick_repository_directory` command through `@tauri-apps/api/core`. Its explicit capability grants only that command to the main window at `http://127.0.0.1:47831/`; the command also validates the window and origin, permits only one native picker at a time, and returns one path or null on cancellation. The text-diff window has no picker capability. The selected directory then uses the existing HTTP repository connection flow. No JavaScript filesystem or shell permissions are granted.

File requests identify an authorized `sectionId`, exact `version`, and `side` (`before` or `after`). DOC text uses `format=text`; Markdown images use `resource` and must be referenced by that document. Original bytes come from the snapshot's Git blobs; working bytes must match the snapshot's hashes. Requests reject stale versions, changed bytes, symlink targets, paths outside the repository, and cross-origin access. File responses use attachment, no-store, and sandbox headers.

The browser save keys are `ordiff.appearance` and `ordiff.review.v2.<repository-path>` (or `demo` for the sample). Saved notes are bounded to 2,000 characters. Keep these storage keys and the saved review shape stable when refactoring. Undo is session-only, lasts six seconds, and resets on a new mark or workspace/version change.

Feedback has its own `ordiff.feedback.v1.<repository-path>` key (`ordiff.feedback.v1.demo` for the sample), containing `comments` and `general`. Comments have stable IDs, an intent, verbatim text, a file path, and an optional captured section ID, diff version, hunk heading, and original/working line ranges. Matching legacy notes import as Note comments only when no feedback record exists; an empty saved feedback record prevents deleted notes from reappearing. The legacy review format remains readable and writable.

Feedback persists independently of diff versions and progress resets. Reference status is derived from the current snapshot without changing the saved anchor. Missing sections and missing files stay exportable; reassignment is explicit. Prompt generation is a pure formatter that selects only commented files and optional general instructions. Copy and Markdown download share its output. No feedback HTTP endpoints, MCP tools, or model calls are added.

Git snapshots allow at most 500 changed files. Text diffs for new files larger than 2 MiB are omitted; supported formats can still use full-file previews up to 25 MiB per revision. Other viewer limits are documented in [the README](../README.md#preview-files). The MCP tools retain their own request and result limits in [the MCP guide](mcp.md#tools).

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
