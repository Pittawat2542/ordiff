import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DiffView } from "../src/diff-view.tsx";

test("repository filenames and source code render as text rather than executable HTML", () => {
  const html = renderToStaticMarkup(
    createElement(DiffView, {
      section: {
        id: "safe-id",
        path: "<img src=x onerror=alert(1)>.js",
        role: "Code",
        language: "JavaScript",
        symbol: "<script>alert(1)</script>",
        lines: [
          {
            type: "add",
            old: null,
            new: 1,
            text: "<img src=x onerror=alert(1)>",
          },
        ],
      },
    }),
  );
  assert.doesNotMatch(html, /<img|<script/);
  assert.ok(html.includes("&lt;img"));
  assert.ok(html.includes("&lt;script&gt;"));
});

test("source highlighting preserves keywords, strings, and comments as escaped text", () => {
  const html = renderToStaticMarkup(
    createElement(DiffView, {
      section: {
        id: "syntax",
        path: "run.ts",
        role: "Code",
        language: "TypeScript",
        lines: [
          {
            type: "add",
            old: null,
            new: 1,
            text: 'export const status = "failed"; // safe <tag>',
          },
        ],
      },
    }),
  );
  assert.ok(html.includes('<span class="token-keyword">export</span>'));
  assert.ok(
    html.includes('<span class="token-string">&quot;failed&quot;</span>'),
  );
  assert.ok(
    html.includes('<span class="token-comment">// safe &lt;tag&gt;</span>'),
  );
});
