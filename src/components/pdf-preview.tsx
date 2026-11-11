import { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { Button } from "./ui/button";
import { Icon } from "../icons";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();
const options = {
  cMapUrl: "/pdfjs/cmaps/",
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  wasmUrl: "/pdfjs/wasm/",
  isEvalSupported: false,
  useWorkerFetch: true,
};
export default function PdfPreview({
  buffer,
  onError,
}: {
  buffer: ArrayBuffer;
  onError: (message: string) => void;
}) {
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1);
  const [width, setWidth] = useState(700);
  const host = useRef<HTMLDivElement>(null);
  const file = useMemo(
    () => ({ data: new Uint8Array(buffer.slice(0)) }),
    [buffer],
  );
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(240, entries[0].contentRect.width - 32)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="pdf-preview" ref={host}>
      <div className="preview-subtoolbar pdf-controls">
        <div className="page-controls">
          <Button
            variant="ghost"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <Icon name="left" />
          </Button>
          <span aria-live="polite">
            Page {page} of {pages || "…"}
          </span>
          <Button
            variant="ghost"
            aria-label="Next page"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            <Icon name="chevron" />
          </Button>
        </div>
        <label>
          Zoom{" "}
          <select
            aria-label="PDF zoom"
            value={scale}
            onChange={(event) => setScale(Number(event.target.value))}
          >
            <option value={0.75}>75%</option>
            <option value={1}>Fit width</option>
            <option value={1.25}>125%</option>
            <option value={1.5}>150%</option>
            <option value={2}>200%</option>
          </select>
        </label>
      </div>
      <div
        className="pdf-pages"
        tabIndex={0}
        role="region"
        aria-label="PDF document preview"
      >
        <Document
          file={file}
          options={options}
          // Keep the binary input mounted while PDF.js loads. Suspense retries
          // would recreate it before this component's first commit.
          suspense={false}
          onLoadSuccess={({ numPages }) => {
            setPages(numPages);
            setPage(1);
          }}
          onLoadError={() =>
            onError(
              "This PDF could not be opened. It may be damaged or password protected.",
            )
          }
          onPassword={() =>
            onError(
              "This PDF is password protected. Download it to open it in your PDF reader.",
            )
          }
          loading={
            <div className="preview-loading" role="status">
              Opening PDF…
            </div>
          }
        >
          <Page
            pageNumber={page}
            width={Math.min(width, 1000) * scale}
            renderAnnotationLayer={false}
            renderTextLayer
            onRenderError={() =>
              onError("This PDF page could not be rendered.")
            }
          />
        </Document>
      </div>
    </div>
  );
}
