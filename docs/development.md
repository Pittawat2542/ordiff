# Developing Ordiff

Ordiff uses React, TypeScript, Vite, Tailwind CSS, and locally owned shadcn/ui controls. The Git API and MCP server are Node.js modules. Install dependencies with `npm install`; Node.js 22.13 or later and Git must be available.

## Source layout

| Location                                   | Responsibility                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `src/App.tsx`                              | Workspace composition, dialogs, keyboard shortcuts, and drawer focus                                    |
| `src/hooks/use-review.ts`                  | Workspace requests, plan polling, browser persistence, explicit review decisions, advancement, and Undo |
| `src/review.ts`                            | Dataset-independent review state, navigation, search, filtering, and progress                           |
| `src/sample-data.ts`                       | The built-in example review; separate from repository parsing and the review model                      |
| `src/types.ts`                             | Frontend data contracts                                                                                 |
| `src/diff-view.tsx`                        | Unified diff, preview tabs, and original/working comparison panes                                       |
| `src/lib/diff.ts`, `src/lib/highlight.ts`  | Change counts and language-aware highlighting                                                           |
| `src/components/`                          | Navigation, review content, footer, dialogs, and file viewers                                           |
| `src/components/ui/`                       | Shared button, input, and textarea controls                                                             |
| `src/style.css`, `src/preview.css`         | App themes, layout, accessibility, and preview styles                                                   |
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

The workspace API serves the selected repository and a revision counter. The browser polls for newly submitted plans; it does not continuously rescan Git. Refresh explicitly after filesystem edits. MCP context retrieval and plan submission also refresh Git before operating.

File requests identify an authorized `sectionId`, exact `version`, and `side` (`before` or `after`). DOC text uses `format=text`; Markdown images use `resource` and must be referenced by that document. Original bytes come from the snapshot's Git blobs; working bytes must match the snapshot's hashes. Requests reject stale versions, changed bytes, symlink targets, paths outside the repository, and cross-origin access. File responses use attachment, no-store, and sandbox headers.

The browser save keys are `ordiff.appearance` and `ordiff.review.v2.<repository-path>` (or `demo` for the sample). Saved notes are bounded to 2,000 characters. Keep these storage keys and the saved review shape stable when refactoring. Undo is session-only, lasts six seconds, and resets on a new mark or workspace/version change.

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
