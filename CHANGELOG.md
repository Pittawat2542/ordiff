# Changelog

## 0.3.0 — 2026-11-13

First tagged release of Ordiff, a local Git review workspace for macOS and browser development.

### Included

- Review working changes, branch comparisons, and two commits with persistent review passes and captured source.
- Follow behaviors across files, organize groups manually, and preview agent-proposed plans before accepting them.
- Capture file, section, and line feedback; publish immutable MCP batches; inspect agent outcomes; resolve feedback yourself.
- Compare passes, defer sections, search and filter changes, and export selected feedback as Markdown prompts.
- Preview images, Markdown, PDF, Word documents, spreadsheets, CSV, audio, and video locally; compare pasted text in a separate utility.
- Run a self-contained Apple Silicon desktop app with a bundled Node runtime, native repository picker, and recent repository history.

### Compatibility and upgrades

- Desktop requires Apple Silicon, macOS 14 or later, and Git. Browser development requires Node.js 22.13 or later and Git.
- This release aligns the package, desktop, and MCP versions at 0.3.0. The earlier MCP plan transport changed; reconnect using **Connect agent** and consult `docs/mcp.md` rather than reusing older tool payloads.
- Quit Ordiff before replacing the app. Updates are manual and preserve local state. Back up `~/Library/Application Support/Ordiff` before upgrading; retain browser/WebView data if you need local drafts and appearance settings.

### Release scope

This is a 0.x release for local use. The macOS app is ad-hoc signed, not Developer ID signed or notarized; macOS may block an app downloaded from GitHub. Building locally is the supported fallback. There is no automatic updater.

VoiceOver, physical sleep/wake, and renewed energy measurements for the review-cycle implementation remain manual checks. Older desktop measurements do not establish the current version's energy use. Intel macOS, Windows, and Linux desktop packages are not included.

### Verification

- 75 core tests and 96 UI tests passed.
- Strict TypeScript checking and the production build passed; Vite reported large-chunk warnings.
- The native release build and packaged integration test passed, including strict signature verification, bundled Node, Git, MCP, and backend shutdown.
- The runtime npm dependency audit reported zero known vulnerabilities at release time. Packaging still reports deprecated transitive dependencies.
