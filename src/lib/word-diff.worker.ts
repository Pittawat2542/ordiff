import type { DiffLine } from "../types";
self.onmessage = (event: MessageEvent<DiffLine[]>) => {
  const lines = event.data,
    result: Record<number, [number, number]> = {};
  let budget = 200000;
  for (let i = 0; i < lines.length && budget > 0; i++) {
    if (lines[i].type !== "remove") continue;
    const removed: number[] = [],
      added: number[] = [];
    while (i < lines.length && lines[i].type === "remove") removed.push(i++);
    while (i < lines.length && lines[i].type === "add") added.push(i++);
    i--;
    for (
      let p = 0;
      p < Math.min(removed.length, added.length) && budget > 0;
      p++
    ) {
      const a = lines[removed[p]].text,
        b = lines[added[p]].text;
      budget -= a.length + b.length;
      if (a.length + b.length > 20000) continue;
      let start = 0,
        endA = a.length,
        endB = b.length;
      while (start < Math.min(endA, endB) && a[start] === b[start]) start++;
      while (start > 0 && /\w/.test(a[start - 1])) start--;
      while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
        endA--;
        endB--;
      }
      while (endA < a.length && /\w/.test(a[endA])) endA++;
      while (endB < b.length && /\w/.test(b[endB])) endB++;
      result[removed[p]] = [start, endA];
      result[added[p]] = [start, endB];
    }
  }
  self.postMessage(result);
};
