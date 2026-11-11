import { parseDocument } from "./document-parser";

self.onmessage = async (
  event: MessageEvent<{ kind: "word" | "spreadsheet"; buffer: ArrayBuffer }>,
) => {
  try {
    self.postMessage({
      result: await parseDocument(event.data.kind, event.data.buffer),
    });
  } catch {
    self.postMessage({ error: true });
  }
};
