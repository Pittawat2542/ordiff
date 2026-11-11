import { Fragment, lazy, Suspense, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Papa from "papaparse";
import { Icon } from "../icons";
import { Button } from "./ui/button";
import { DocumentPreview, Spreadsheet } from "./document-preview";
import {
  fileUrl,
  fetchFile,
  formatSize,
  MAX_PREVIEW_BYTES,
  previewKind,
} from "../lib/file-preview";
import { highlightLines, languageFor } from "../lib/highlight";
import type { DiffSection } from "../types";

const PdfPreview = lazy(() => import("./pdf-preview"));
type Side = "before" | "after";
export default function FilePreview({
  section,
  version,
  side,
  showCaption = true,
}: {
  section: DiffSection;
  version?: string;
  side: Side;
  showCaption?: boolean;
}) {
  const kind = previewKind(section);
  const revision = section.file?.[side];
  const [asset, setAsset] = useState<{
    buffer: ArrayBuffer;
    url: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const url =
    section.file && version
      ? fileUrl(
          section.id,
          version,
          side,
          kind === "word-doc" ? "text" : undefined,
        )
      : null;
  useEffect(() => {
    if (
      !url ||
      kind === "unsupported" ||
      (revision && revision.size > MAX_PREVIEW_BYTES)
    )
      return;
    const abort = new AbortController();
    let objectUrl: string | undefined;
    setAsset(null);
    setError("");
    void fetchFile(url, abort.signal)
      .then(({ buffer, mimeType }) => {
        if (abort.signal.aborted) return;
        if (["image", "audio", "video"].includes(kind))
          objectUrl = URL.createObjectURL(
            new Blob([buffer], {
              type:
                mimeType === "application/octet-stream"
                  ? section.file?.mimeType
                  : mimeType,
            }),
          );
        setAsset({ buffer, url: objectUrl || "" });
      })
      .catch((error) => {
        if (!abort.signal.aborted)
          setError(error.message || "This file could not be opened.");
      });
    return () => {
      abort.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, kind, revision?.size, section.file?.mimeType, attempt]);

  const sectionText = useMemo(
    () =>
      (section.lines || [])
        .filter((line) =>
          side === "after" ? line.type !== "remove" : line.type !== "add",
        )
        .map((line) => line.text)
        .join("\n"),
    [section.lines, side],
  );
  if (revision && revision.size > MAX_PREVIEW_BYTES)
    return (
      <PreviewFallback
        title="This file is too large to preview."
        description="Previews support files up to 25 MiB. Open this file in your editor."
      />
    );
  if (kind === "unsupported")
    return (
      <PreviewFallback
        title={`No inline preview for ${section.path.split(".").at(-1)?.toUpperCase() || "this file type"} files.`}
        description="Download the file to open it in its usual application."
      />
    );
  if (error)
    return (
      <div className="preview-failure">
        <Icon name="file" />
        <p role="alert">{error}</p>
        <Button
          variant="secondary"
          onClick={() => {
            setError("");
            setAsset(null);
            setAttempt((value) => value + 1);
          }}
        >
          Retry preview
        </Button>
      </div>
    );
  if (url && !asset)
    return (
      <div className="preview-loading" role="status">
        Opening preview…
      </div>
    );
  if (!url && !["markdown", "csv"].includes(kind))
    return (
      <PreviewFallback
        title="File contents are not available."
        description="Refresh the diff to load this file’s preview."
      />
    );
  const text =
    asset && ["markdown", "csv", "word-doc"].includes(kind)
      ? new TextDecoder().decode(asset.buffer)
      : sectionText;
  return (
    <div className="file-preview">
      {showCaption && (
        <div className="preview-caption">
          {url
            ? side === "before"
              ? "Original file"
              : "Working tree"
            : "Section preview"}
          {revision ? ` · ${formatSize(revision.size)}` : ""}
          {section.file && !section.file.after ? " · Deleted file" : ""}
        </div>
      )}
      {kind === "markdown" && (
        <MarkdownPreview
          text={text}
          section={section}
          version={version}
          side={side}
        />
      )}
      {kind === "csv" && <CsvPreview text={text} />}
      {kind === "image" && asset && (
        <ImagePreview
          src={asset.url}
          name={section.path}
          onError={() =>
            setError(
              "Your browser could not display this image. Download it to open it in an image viewer.",
            )
          }
        />
      )}
      {kind === "pdf" && asset && (
        <Suspense
          fallback={<div className="preview-loading">Opening PDF viewer…</div>}
        >
          <PdfPreview buffer={asset.buffer} onError={setError} />
        </Suspense>
      )}
      {(kind === "word" || kind === "spreadsheet") && asset && (
        <DocumentPreview
          key={`${side}:${attempt}`}
          kind={kind}
          buffer={asset.buffer}
          onError={setError}
        />
      )}
      {kind === "word-doc" && (
        <div className="document-body">
          <p className="preview-caption">
            Word text preview
            {text.length >= 200000 ? " · First 200,000 characters" : ""}
          </p>
          <pre className="word-text">{text}</pre>
        </div>
      )}
      {kind === "audio" && asset && (
        <div className="media-preview">
          <Icon name="file" />
          <audio
            controls
            preload="metadata"
            src={asset.url}
            aria-label={`${section.path} audio preview`}
            onError={() =>
              setError("This audio format is not supported by your browser.")
            }
          />
        </div>
      )}
      {kind === "video" && asset && (
        <div className="media-preview">
          <video
            controls
            preload="metadata"
            src={asset.url}
            aria-label={`${section.path} video preview`}
            onError={() =>
              setError("This video format is not supported by your browser.")
            }
          />
        </div>
      )}
    </div>
  );
}
function PreviewFallback({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="preview-fallback">
      <Icon name="file" />
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}
function ImagePreview({
  src,
  name,
  onError,
}: {
  src: string;
  name: string;
  onError: () => void;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [scale, setScale] = useState("fit");
  return (
    <div className="image-preview">
      <div className="preview-subtoolbar">
        <span>
          {size.width ? `${size.width} × ${size.height} px` : "Image preview"}
        </span>
        <label>
          Scale{" "}
          <select
            aria-label="Image scale"
            value={scale}
            onChange={(event) => setScale(event.target.value)}
          >
            <option value="fit">Fit</option>
            <option value="1">Actual size</option>
            <option value="1.5">150%</option>
            <option value="2">200%</option>
          </select>
        </label>
      </div>
      <div
        className={`image-viewport ${scale === "fit" ? "image-fit" : ""}`}
        tabIndex={0}
        role="region"
        aria-label="Image preview"
      >
        <img
          src={src}
          alt={name}
          onError={onError}
          onLoad={(event) =>
            setSize({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            })
          }
          style={
            scale !== "fit" && size.width
              ? { width: size.width * Number(scale), maxWidth: "none" }
              : undefined
          }
        />
      </div>
    </div>
  );
}
function CsvPreview({ text }: { text: string }) {
  const parsed = useMemo(
    () => Papa.parse<string[]>(text, { skipEmptyLines: true, preview: 201 }),
    [text],
  );
  const columns = parsed.data.reduce(
    (count, row) => Math.max(count, row.length),
    0,
  );
  return (
    <Spreadsheet
      sheets={[
        {
          name: "CSV",
          rows: parsed.data.slice(0, 200).map((row) => row.slice(0, 50)),
          totalRows: parsed.meta.truncated
            ? Math.max(201, parsed.data.length)
            : parsed.data.length,
          totalColumns: columns,
        },
      ]}
    />
  );
}
function MarkdownPreview({
  text,
  section,
  version,
  side,
}: {
  text: string;
  section: DiffSection;
  version?: string;
  side: Side;
}) {
  return (
    <div
      className="markdown-preview prose-preview"
      role="document"
      aria-label={`${section.path} Markdown preview`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a: ({ href, children }) =>
            href && /^(https?:|mailto:|#)/i.test(href) ? (
              <a
                href={href}
                target={href.startsWith("#") ? undefined : "_blank"}
                rel="noopener noreferrer"
              >
                {children}
              </a>
            ) : (
              <span title={href}>{children}</span>
            ),
          img: ({ src, alt }) => (
            <MarkdownImage
              source={String(src || "")}
              alt={alt || "Image"}
              section={section}
              version={version}
              side={side}
            />
          ),
          code: ({ className, children }) => {
            const language = className?.match(/language-([\w+-]+)/)?.[1];
            if (!language) return <code>{children}</code>;
            const tokens = highlightLines(
              String(children).replace(/\n$/, ""),
              languageFor({ path: `code.${language}`, language }),
            );
            return (
              <code className={className}>
                {tokens.map((line, index) => (
                  <Fragment key={index}>
                    {index > 0 && "\n"}
                    {line.map((token, i) =>
                      token.className ? (
                        <span className={token.className} key={i}>
                          {token.text}
                        </span>
                      ) : (
                        <Fragment key={i}>{token.text}</Fragment>
                      ),
                    )}
                  </Fragment>
                ))}
              </code>
            );
          },
        }}
      >
        {text.slice(0, 500000)}
      </ReactMarkdown>
      {text.length > 500000 && (
        <p className="preview-caption">
          Preview limited to the first 500,000 characters.
        </p>
      )}
    </div>
  );
}
function MarkdownImage({
  source,
  alt,
  section,
  version,
  side,
}: {
  source: string;
  alt: string;
  section: DiffSection;
  version?: string;
  side: Side;
}) {
  const [src, setSrc] = useState("");
  const [failed, setFailed] = useState(false);
  const external = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(source);
  useEffect(() => {
    if (!source || external || !version || !section.file) return;
    const abort = new AbortController();
    let url: string | undefined;
    void fetchFile(
      fileUrl(section.id, version, side, undefined, source),
      abort.signal,
    )
      .then(({ buffer, mimeType }) => {
        if (abort.signal.aborted) return;
        url = URL.createObjectURL(new Blob([buffer], { type: mimeType }));
        setSrc(url);
      })
      .catch(() => {
        if (!abort.signal.aborted) setFailed(true);
      });
    return () => {
      abort.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [source, external, section.id, section.file, side, version]);
  if (src && !failed)
    return <img src={src} alt={alt} onError={() => setFailed(true)} />;
  return (
    <span className="markdown-image-placeholder">
      <Icon name="file" />
      <span>
        {alt}
        <small>
          {external
            ? "External image"
            : failed
              ? "Image unavailable"
              : "Local image"}
        </small>
      </span>
    </span>
  );
}
