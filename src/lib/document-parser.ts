export interface PreviewSheet {
  name: string;
  rows: string[][];
  totalRows: number;
  totalColumns: number;
}
export type ParsedDocument =
  | { kind: "word"; html: string }
  | { kind: "spreadsheet"; sheets: PreviewSheet[]; totalSheets: number };

export async function parseDocument(
  kind: "word" | "spreadsheet",
  buffer: ArrayBuffer,
): Promise<ParsedDocument> {
  if (kind === "word") {
    const mammoth = (await import("mammoth/mammoth.browser.js")).default;
    const result = await mammoth.convertToHtml(
      { arrayBuffer: buffer },
      {
        externalFileAccess: false,
        includeEmbeddedStyleMap: false,
        convertImage: mammoth.images.imgElement(async (image) => ({
          src: /^image\/(png|jpeg|gif|webp|bmp)$/.test(image.contentType)
            ? `data:${image.contentType};base64,${await image.readAsBase64String()}`
            : "",
        })),
      },
    );
    return { kind: "word", html: result.value };
  }
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheets = workbook.worksheets.slice(0, 20).map((sheet) => ({
    name: sheet.name,
    totalRows: sheet.rowCount,
    totalColumns: sheet.columnCount,
    rows: Array.from({ length: Math.min(sheet.rowCount, 200) }, (_, row) =>
      Array.from({ length: Math.min(sheet.columnCount, 50) }, (_, col) => {
        const cell = sheet.getRow(row + 1).getCell(col + 1);
        if (cell.value instanceof Date)
          return cell.value.toISOString().slice(0, 10);
        if (cell.formula && cell.result === undefined)
          return `=${cell.formula}`;
        return cell.text;
      }),
    ),
  }));
  return {
    kind: "spreadsheet",
    sheets,
    totalSheets: workbook.worksheets.length,
  };
}

export async function parseDocumentOffThread(
  kind: "word" | "spreadsheet",
  buffer: ArrayBuffer,
  signal: AbortSignal,
): Promise<ParsedDocument> {
  if (typeof Worker === "undefined") {
    try {
      return await parseDocument(kind, buffer);
    } catch {
      throw new Error(
        "This document could not be read. It may be damaged or password protected.",
      );
    }
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./document.worker.ts", import.meta.url),
      { type: "module" },
    );
    const stop = () => {
      clearTimeout(timer);
      worker.terminate();
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      stop();
      reject(new DOMException("Preview cancelled", "AbortError"));
    };
    const timer = setTimeout(() => {
      stop();
      reject(
        new Error(
          "This document took too long to open. Download it to continue.",
        ),
      );
    }, 20000);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) return abort();
    worker.onmessage = (event) => {
      stop();
      if (event.data.error)
        reject(
          new Error(
            "This document could not be read. It may be damaged or password protected.",
          ),
        );
      else resolve(event.data.result);
    };
    worker.onerror = () => {
      stop();
      reject(new Error("This document could not be read."));
    };
    const copy = buffer.slice(0);
    worker.postMessage({ kind, buffer: copy }, [copy]);
  });
}
