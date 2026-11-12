import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Compartment } from "@codemirror/state";
import {
  drawSelection,
  EditorView,
  keymap,
  lineNumbers,
  placeholder,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  isolateHistory,
} from "@codemirror/commands";
import { MergeView } from "@codemirror/merge";
import { Brand } from "../components/brand";
import { Button } from "../components/ui/button";
import { Icon } from "../icons";
import type { Theme } from "../types";
import "./text-diff.css";

function savedAppearance(): Theme {
  try {
    return localStorage.getItem("ordiff.appearance") === "dark"
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

export default function TextDiff() {
  const [theme, setTheme] = useState(savedAppearance);
  const [wrapped, setWrapped] = useState(true);
  const [stats, setStats] = useState({
    blocks: 0,
    originalLines: 0,
    modifiedLines: 0,
    hasText: false,
  });
  const host = useRef<HTMLDivElement>(null);
  const merge = useRef<MergeView | null>(null);
  const currentChange = useRef(-1);
  const [wrapping] = useState(() => new Compartment());
  const [appearance] = useState(() => new Compartment());

  useEffect(() => {
    const previous = document.title;
    document.title = "Text diff — Ordiff utilities";
    return () => {
      document.title = previous;
    };
  }, []);

  useLayoutEffect(() => {
    if (!host.current) return;
    function sync() {
      const view = merge.current;
      if (!view) return;
      const a = view.a.state.doc,
        b = view.b.state.doc;
      currentChange.current = -1;
      setStats({
        blocks: view.chunks.length,
        originalLines: a.length ? a.lines : 0,
        modifiedLines: b.length ? b.lines : 0,
        hasText: Boolean(a.length || b.length),
      });
    }
    const extensions = (label: string) => [
      lineNumbers(),
      history(),
      drawSelection(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      placeholder(`Paste ${label.toLowerCase()} text here…`),
      EditorView.contentAttributes.of({
        "aria-label": `${label} text`,
        "aria-multiline": "true",
        spellcheck: "false",
        autocorrect: "off",
        autocapitalize: "off",
      }),
      wrapping.of(EditorView.lineWrapping),
      appearance.of([]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) sync();
      }),
    ];
    const view = new MergeView({
      parent: host.current,
      a: { doc: "", extensions: extensions("Original") },
      b: { doc: "", extensions: extensions("Modified") },
      highlightChanges: true,
      gutter: true,
    });
    merge.current = view;
    return () => {
      merge.current = null;
      view.destroy();
    };
  }, [wrapping, appearance]);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("ordiff.appearance", theme);
    } catch {
      /* Appearance still works without storage. */
    }
    const view = merge.current;
    if (view)
      for (const editor of [view.a, view.b]) {
        editor.dispatch({
          effects: appearance.reconfigure(
            EditorView.theme({}, { dark: theme === "dark" }),
          ),
        });
      }
  }, [theme, appearance]);

  useLayoutEffect(() => {
    const view = merge.current;
    if (view)
      for (const editor of [view.a, view.b]) {
        editor.dispatch({
          effects: wrapping.reconfigure(wrapped ? EditorView.lineWrapping : []),
        });
      }
  }, [wrapped, wrapping]);

  function replaceBoth(original: string, modified: string) {
    const view = merge.current;
    if (!view) return;
    for (const [editor, text] of [
      [view.a, original],
      [view.b, modified],
    ] as const) {
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: text },
        selection: { anchor: 0 },
        annotations: isolateHistory.of("full"),
      });
    }
    view.dom.scrollTop = 0;
  }

  function navigate(direction: number) {
    const view = merge.current;
    if (!view?.chunks.length) return;
    const count = view.chunks.length;
    const index =
      currentChange.current < 0
        ? direction > 0
          ? 0
          : count - 1
        : (currentChange.current + direction + count) % count;
    currentChange.current = index;
    const chunk = view.chunks[index];
    for (const [editor, from] of [
      [view.a, chunk.fromA],
      [view.b, chunk.fromB],
    ] as const) {
      const anchor = Math.min(from, editor.state.doc.length);
      editor.dispatch({
        selection: { anchor },
        effects: EditorView.scrollIntoView(anchor, { y: "center" }),
      });
    }
    view.b.focus();
  }

  const status = !stats.hasText
    ? "Paste text into either pane to start comparing."
    : stats.blocks
      ? `${stats.blocks} changed ${stats.blocks === 1 ? "block" : "blocks"}`
      : "Texts are identical";

  return (
    <div className="text-diff-page">
      <a className="skip-link" href="#text-diff-editors">
        Skip to text editors
      </a>
      <header className="text-diff-header">
        <a href="/" className="utility-brand" aria-label="Ordiff home">
          <Brand wordmark />
        </a>
        <span className="utility-breadcrumb">
          / <span>Utilities</span>
        </span>
        <Button
          variant="ghost"
          aria-label={`Switch to ${theme === "light" ? "dark" : "light"} appearance`}
          title={`Switch to ${theme === "light" ? "dark" : "light"} appearance`}
          onClick={() => setTheme(theme === "light" ? "dark" : "light")}
        >
          <Icon name={theme === "light" ? "moon" : "sun"} />
        </Button>
      </header>
      <main className="text-diff-main">
        <div className="text-diff-intro">
          <div>
            <p className="eyebrow">ORDIFF UTILITY</p>
            <h1>Text diff</h1>
            <p>Paste two versions. See what changed.</p>
          </div>
          <span className="utility-local">
            <Icon name="lock" />
            Only in this tab
          </span>
        </div>
        <section className="text-diff-card" aria-label="Text comparison">
          <div className="text-diff-controls">
            <div className="text-diff-actions">
              <Button
                variant="secondary"
                disabled={!stats.hasText}
                onClick={() => {
                  const view = merge.current;
                  if (view)
                    replaceBoth(
                      view.b.state.doc.toString(),
                      view.a.state.doc.toString(),
                    );
                }}
              >
                <Icon name="swap" />
                Swap
              </Button>
              <Button
                variant="secondary"
                aria-pressed={wrapped}
                onClick={() => setWrapped(!wrapped)}
              >
                <Icon name="wrap" />
                Wrap lines
              </Button>
              <Button
                variant="link"
                disabled={!stats.hasText}
                onClick={() => replaceBoth("", "")}
              >
                Clear both
              </Button>
            </div>
            <div
              className="text-diff-navigation"
              role="group"
              aria-label="Change navigation"
            >
              <Button
                variant="ghost"
                aria-label="Previous change"
                title="Previous change"
                disabled={!stats.blocks}
                onClick={() => navigate(-1)}
              >
                <Icon name="up" />
              </Button>
              <Button
                variant="ghost"
                aria-label="Next change"
                title="Next change"
                disabled={!stats.blocks}
                onClick={() => navigate(1)}
              >
                <Icon name="down" />
              </Button>
            </div>
          </div>
          <div className="text-diff-pane-headings">
            <div>
              <h2>
                <span className="pane-sign original-sign" aria-hidden="true">
                  −
                </span>
                Original
              </h2>
              <span>
                {stats.originalLines}{" "}
                {stats.originalLines === 1 ? "line" : "lines"}
              </span>
            </div>
            <div>
              <h2>
                <span className="pane-sign modified-sign" aria-hidden="true">
                  +
                </span>
                Modified
              </h2>
              <span>
                {stats.modifiedLines}{" "}
                {stats.modifiedLines === 1 ? "line" : "lines"}
              </span>
            </div>
          </div>
          <div
            className="text-diff-editors"
            id="text-diff-editors"
            ref={host}
            tabIndex={-1}
          />
          <div className="text-diff-status">
            <p role="status" aria-live="polite">
              {!stats.blocks && stats.hasText && <Icon name="check" />}
              {status}
            </p>
            <span>Live comparison</span>
          </div>
        </section>
        <p className="text-diff-footnote">
          Text stays in this browser tab. Reloading clears both panes.
        </p>
      </main>
    </div>
  );
}
