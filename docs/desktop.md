# Ordiff on macOS

The personal desktop build targets Apple Silicon and macOS 14+. A Tauri 2 shell uses WKWebView to display the production React app. A bundled official Node 24.22.2 ARM64 executable serves static UI assets and the existing Git/MCP API at `http://127.0.0.1:47831`. Its SHA-256 is pinned in the preparation script. Runtime dependencies and Node's license ship in the app. The build is locally ad-hoc signed; updates are manual.

## Build and install

Install Apple's Command Line Tools, rustup, and the repository's Node dependencies. The repository pins Rust 1.95; rustup resolves it automatically.

```sh
npm run desktop:build
npm run desktop:install
```

The app is built at `src-tauri/target/release/bundle/macos/Ordiff.app` and installed at `~/Applications/Ordiff.app`. Quit the installed app before updating. Installation replaces the app bundle and preserves saved state. Launch from Spotlight, Finder, or the Dock; pin it with **Options → Keep in Dock**. For native development, `npm run desktop:dev` prepares resources and opens the debug app; rerun it after source edits.

The app bundles Node independently of Homebrew and resolves runtime resources relative to itself. Git is resolved through the standard macOS system path. No server or Terminal session needs to be started separately. A second launch focuses the existing window. The text-diff utility opens a separate app window, external links open in their default app, and downloads save to Downloads with unique names.

## Lifecycle and storage

The native app waits for an explicit backend readiness message before opening the UI. An occupied port or backend startup failure produces an error window. An unexpected backend exit produces an actionable dialog. Launch-on-login and automatic update services are absent.

Closing the final window or choosing Quit closes the backend's parent pipe. Node terminates active Git subprocesses, closes HTTP/SSE connections, and exits, including document workers. A blocked shutdown has a five-second native termination deadline. Native crashes also close the pipe, so the backend exits without a periodic heartbeat. MCP adapters belong to their clients; they remain idle until a tool call, and report when Ordiff is unavailable.

Workspace selection, the ten most recent repositories, and agent plans persist in `~/Library/Application Support/Ordiff/workspace.json`. Closing a repository keeps its history; removing a recent entry leaves the active review open. Review progress, feedback, and appearance use the existing storage keys in a stable, dedicated persistent WebKit data store. Browser state is independent and is not imported. The desktop origin differs from Vite's development port, so both can run together.

## Startup work

Startup keeps Markdown image parsing and review-plan schema validation unloaded until their respective API requests need them. Restoring a saved plan validates it against the Git snapshot just read by repository restoration; new plan submissions still refresh Git before validation to reject stale plans.

Local startup measurements (seven sequential launches per scenario, bundled Node 24.22.2, disposable state and a repository with 40 untracked TypeScript files and an empty initial commit) showed median backend readiness falling from **85 ms to 47 ms** without an active repository. With a saved plan, median time from spawning Node to receiving `/api/workspace` fell from **197 ms to 107 ms**. These are warm filesystem-cache backend measurements, not full native launch-to-paint times; the first post-change empty-workspace sample was 185 ms. Native window creation and WebKit rendering are excluded.

## Idle work

`GET /api/events` publishes revision notifications without heartbeat traffic. The UI retrieves a snapshot after changes and resynchronizes after a hidden window is shown. It disconnects while hidden, minimized, unfocused on desktop, or in sample mode. Reconnection after failure uses bounded exponential backoff, with no retry activity while hidden. Native focus events supplement Page Visibility for macOS window minimization and app switching.

Git runs only on repository selection, explicit refresh, and MCP operations. Document parsers remain lazy and bounded. Hidden media pauses without automatically restarting; CSS animations pause while hidden, and reduced-motion behavior remains supported. The main loopback review window has one narrowly scoped Tauri command, `pick_repository_directory`, for opening the native single-folder dialog. Its capability and runtime checks restrict it to that window and origin; it exposes no filesystem or shell commands. External navigation is handled outside the WebView.

## Verification

```sh
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
npm run desktop:build
codesign --verify --deep --strict src-tauri/target/release/bundle/macos/Ordiff.app
npm run desktop:verify
```

Exercise a real repository, same-diff refresh, MCP plan submission, prompt copying and downloading, image/document previews, and the text-diff window. Confirm review state and appearance persist across quit/relaunch. Test repeated launch, an occupied port, unexpected backend exit, native-parent termination, minimization/resume, and closing the final window. Confirm app-owned processes terminate and port 47831 is released. Test sleep/wake on the laptop during normal use.

For repository selection, use **Browse folders** from onboarding and the toolbar repository switcher. Verify native cancellation, an invalid folder, and a valid checkout (including a path containing spaces). Check recent search/removal and persistence across relaunch, and confirm that failures preserve the current review. In browser development, exercise breadcrumbs, Up/Home, hidden folders, and explicit folder opening in the in-app browser. Check both appearances, a narrow window, keyboard focus return, and Escape dismissal.

For energy measurement, use the release app and let startup settle. In Activity Monitor inspect Ordiff, its bundled Node backend, and associated WebKit helpers. Measure five minutes of foreground idle and five minutes minimized; record total CPU time deltas, RSS, and Energy Impact. The idle target is less than 1% of one core averaged across the process group, with zero recurring application polling or Git scans. Also inspect active reading and a document preview. Energy Impact is a relative macOS score; CPU measurements alone do not establish battery runtime.

Rust 1.95 has a macOS 27 loader issue when stripping compiler-plugin debug information. Explicit `strip = "none"` for release and build dependencies avoids it; see [the upstream issue](https://github.com/rust-lang/rust/issues/157750).

## Recorded local validation

Verified on this Apple Silicon laptop running macOS 27.2.1, using release builds of Ordiff 0.2.0 and a disposable four-file repository. Measurements include the native shell, bundled Node, and WebKit WebContent, Networking, and GPU helpers, attributed with macOS process responsibility IDs. CPU is the change in their summed CPU time divided by wall time, expressed as a percentage of one core. Memory is summed RSS, which can count shared pages more than once.

| Scenario | Duration | Average CPU | Combined RSS |
| --- | --- | --- | --- |
| Foreground idle, text diff selected | 300 seconds | 0.130% | 364 MiB |
| Minimized idle | 300 seconds | 0.043% | 361 MiB |
| DOCX preview idle | 30 seconds | 0.100% | 375 MiB |

Activity Monitor showed **0.0 Energy Impact** and **Preventing Sleep: No** while minimized. These samples meet the idle CPU target for this fixture; battery runtime and larger active workloads were not measured. Raw process snapshots and CPU time deltas are retained in the ignored `output/desktop-validation/` directory.

Validation passed: 45 core tests, 77 UI tests, the production build, native compilation, strict signature verification, and a separate signed-bundle test exercising Git and both MCP tools from a temporary working directory. Native interaction checks covered Finder launching and minimized-window restoration, appearance and progress persistence after relaunch, Markdown and DOCX previews, clipboard copying, an actual Markdown download, the utility window's live comparison, and an occupied-port error followed by successful recovery. Closing the main window kept the utility and API available; closing the final window and Quit both released the API port. The test workspace was disconnected afterward.

Physical sleep/wake remains a manual laptop check. Visibility, request cancellation, reconnect/resynchronization, and parent-pipe shutdown have automated coverage. Repeat energy measurements after changes to idle work or rendering; a framework choice alone does not establish power efficiency.
