# Ordiff UI concept — generation prompt

Mode: built-in imagegen tool. One new, opaque raster image; no reference images or CLI fallback.

Asset: [ordiff-review-concept.png](images/ordiff-review-concept.png).

The following is the complete prompt submitted for the UI concept. It describes an imagined product and illustrative code.

```text
Use case: ui-mockup
Asset type: high-fidelity raster UI concept for the Ordiff project README.

Primary request: Create one polished, believable desktop Git diff review interface for Ordiff, a product concept that lets a human review one behavior at a time across pipeline, UI, tests, and documentation. The distinctive idea is a guided path through connected diff sections across files. This is an app screenshot, not a marketing graphic.

Composition: Landscape canvas, approximately 16:10, high resolution. Straight-on orthographic view. The app fills the frame with no laptop, device, browser frame, perspective, background scene, or floating windows. Use three practical zones: a narrow behavior navigation sidebar, a generous central diff reading area, and a compact explanation rail beside the selected diff. The code must have enough space to be readable. Align everything to a precise desktop grid.

Visual treatment: Neutral dark desktop styling, matte charcoal surfaces, subtly lighter cards, restrained one-pixel borders, off-white primary text, clearly legible secondary text. Conventional muted red removed lines and muted green added lines. A crisp modern sans serif for navigation and a generous monospace for code. Use hierarchy, spacing, and a thin path connector rather than decoration. No gradients, glow, glass effects, illustrations, promotional headlines, charts, chat panel, or decorative dashboard widgets.

Top bar: A small text wordmark "Ordiff" (spell O-r-d-i-f-f), repository "demo-pipeline", and branch "feature/run-status". Keep this bar quiet.

Navigation sidebar: Heading exactly "Review path". Show three behavior groups with simple numbered markers. Selected group: "Expose pipeline failure status", wrapping naturally across lines. Other groups: "Retry failed runs" and "Refresh setup guidance". The selected item has a restrained lighter background. Keep "Ungrouped changes" and "All changes" visibly accessible below the behavior groups; do not hide them in a menu. Ungrouped changes may have a small count badge "2". This is behavior navigation, not an alphabetical file tree.

Central group header: Title exactly "Expose pipeline failure status". A small badge exactly "Agent-proposed". One-line intent exactly "Make failed pipeline runs visible in the UI."

Immediately below the header, show a connected horizontal reading sequence with the labels "Pipeline", "UI", "Tests", and "Docs", linked by arrows in that order. "UI" is clearly the selected step, with a bright neutral outline and stronger text. Label the current position "Step 2 of 4".

Central diff cards: Show related cards connected by a subtle vertical path line. A compact upstream pipeline diff above the active UI diff makes the dependency concrete. Use filenames and conventional line-number gutters, + and - markers, understated syntax coloring, and normal inline unified diff layout.

Pipeline card filename: "pipeline/run.ts"
Small role label: "Pipeline output"
Render this concise code verbatim, preserving punctuation:
- return { id: run.id, completed: run.done };
+ return { id: run.id, status: run.status };
The removed line has a muted red row and the added line a muted green row.

The active UI card is larger, visually emphasized with a restrained border.
Filename: "ui/RunStatus.tsx"
Small role label: "UI consumer"
Render this code verbatim with the first line as unchanged context:
  const run = useRun(runId);
- return <StatusBadge complete={run.completed} />;
+ return <StatusBadge status={run.status} />;
The removed and added rows must have distinct red and green backgrounds. Use real readable code rather than pseudotext. Keep the text away from clipping boundaries.

Explanation rail, aligned beside the active UI card: Heading "Why this follows". Text exactly "The UI now reads the status exposed by the pipeline." Beneath that, a compact review cue exactly "Check that failed runs render distinctly." This is a short grounded explanation of the selected code, not a conversation or chatbot. Include a subtle "Show surrounding context" text control at the active diff.

Below the active card, show two compact upcoming rows, with readable labels:
"Tests" — "Verify failed-state rendering"
"Docs" — "Document status values"
These are the next steps in the same behavior and are visibly secondary.

Bottom action area: A clearly visible "Mark reviewed" button and a separate "Next step" button with a small "Tests" destination label. A neutral secondary caption "Agent guidance is optional" can sit near the review path footer.

Constraints: Produce a single coherent interface with exact spelling of the specified important labels, consistent code references, realistic desktop density, and ample reading space. The main title and code should be the visual focus. All behavior groups are suggestions for a human reviewer. Keep both the complete diff entry and ungrouped changes visible. No approval-success claims, automatic approval, fake quality scores, or claims that the software already exists. No text outside the app, watermark, mockup caption, or presentation framing.
```
