import { parentPort, workerData } from 'node:worker_threads';
import WordExtractor from 'word-extractor';

try {
  const document = await new WordExtractor().extract(Buffer.from(workerData));
  parentPort.postMessage({ text: document.getBody().slice(0, 200000) });
} catch { parentPort.postMessage({ error: true }); }
