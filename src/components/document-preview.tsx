import { useEffect, useRef, useState } from "react";
import {
  parseDocumentOffThread,
  type ParsedDocument,
  type PreviewSheet,
} from "../lib/document-parser";

const elements = [
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "s",
  "sup",
  "sub",
  "br",
  "hr",
  "ol",
  "ul",
  "li",
  "table",
  "thead",
  "tbody",
  "tr",
  "td",
  "th",
  "blockquote",
  "pre",
  "code",
  "img",
  "a",
  "div",
  "span",
];
const attributes = ["src", "alt", "title", "colspan", "rowspan"];
export function SafeDocument({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    async function insert() {
      const element = ref.current as
        | (HTMLDivElement & {
            setHTML?: (html: string, options: unknown) => void;
          })
        | null;
      if (!element) return;
      if (typeof element.setHTML === "function") {
        const template = document.createElement(
          "template",
        ) as HTMLTemplateElement & {
          setHTML: (html: string, options: unknown) => void;
        };
        template.setHTML(html, { sanitizer: { elements, attributes } });
        template.content.querySelectorAll("img").forEach((image) => {
          if (
            !/^data:image\/(?:png|jpeg|gif|webp|bmp);base64,[a-z\d+/=]+$/i.test(
              image.getAttribute("src") || "",
            )
          )
            image.removeAttribute("src");
        });
        element.replaceChildren(template.content);
      } else {
        const DOMPurify = (await import("dompurify")).default;
        if (!active) return;
        element.innerHTML = DOMPurify.sanitize(html, {
          ALLOWED_TAGS: elements,
          ALLOWED_ATTR: attributes,
          ALLOW_DATA_ATTR: false,
          ALLOW_ARIA_ATTR: false,
          ALLOWED_URI_REGEXP: /^data:image\/(?:png|jpeg|gif|webp|bmp);base64,/i,
        });
      }
    }
    void insert();
    return () => {
      active = false;
    };
  }, [html]);
  return (
    <div
      className="document-body prose-preview"
      role="document"
      aria-label="Word document preview"
      ref={ref}
    />
  );
}
export function DocumentPreview({
  kind,
  buffer,
  onError,
}: {
  kind: "word" | "spreadsheet";
  buffer: ArrayBuffer;
  onError: (message: string) => void;
}) {
  const [result, setResult] = useState<ParsedDocument | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    void parseDocumentOffThread(kind, buffer, abort.signal)
      .then((value) => {
        if (!abort.signal.aborted) setResult(value);
      })
      .catch((error) => {
        if (!abort.signal.aborted)
          onError(error.message || "This document could not be read.");
      });
    return () => abort.abort();
  }, [kind, buffer, onError]);
  if (!result)
    return (
      <div className="preview-loading" role="status">
        Reading document…
      </div>
    );
  return result.kind === "word" ? (
    <SafeDocument html={result.html} />
  ) : (
    <Spreadsheet sheets={result.sheets} totalSheets={result.totalSheets} />
  );
}
export function Spreadsheet({
  sheets,
  totalSheets = sheets.length,
}: {
  sheets: PreviewSheet[];
  totalSheets?: number;
}) {
  const [index, setIndex] = useState(0);
  const sheet = sheets[index];
  if (!sheet)
    return <p className="preview-empty">This workbook has no worksheets.</p>;
  function columnName(index: number): string {
    return index < 26
      ? String.fromCharCode(65 + index)
      : `${String.fromCharCode(64 + Math.floor(index / 26))}${String.fromCharCode(65 + (index % 26))}`;
  }
  return (
    <div className="spreadsheet-preview">
      <div className="preview-subtoolbar">
        {sheets.length > 1 ? (
          <label>
            Worksheet{" "}
            <select
              aria-label="Worksheet"
              value={index}
              onChange={(event) => setIndex(Number(event.target.value))}
            >
              {sheets.map((sheet, index) => (
                <option key={index} value={index}>
                  {sheet.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span>{sheet.name}</span>
        )}
        <span>
          {sheet.totalRows.toLocaleString()} rows · {sheet.totalColumns} columns
        </span>
      </div>
      {sheet.totalRows > 200 ||
      sheet.totalColumns > 50 ||
      totalSheets > sheets.length ? (
        <p className="preview-caption">
          Showing the first 200 rows, 50 columns, and 20 worksheets.
        </p>
      ) : null}
      <div
        className="spreadsheet-scroll"
        tabIndex={0}
        role="region"
        aria-label={`${sheet.name} worksheet`}
      >
        <table aria-label={`${sheet.name} spreadsheet preview`}>
          <thead>
            <tr>
              <th aria-label="Row" />
              {Array.from(
                { length: Math.min(sheet.totalColumns, 50) },
                (_, i) => (
                  <th scope="col" key={i}>
                    {columnName(i)}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, i) => (
              <tr key={i}>
                <th scope="row">{i + 1}</th>
                {row.map((value, col) => (
                  <td key={col}>{value}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!sheet.rows.length && (
          <p className="preview-empty">This worksheet is empty.</p>
        )}
      </div>
    </div>
  );
}
