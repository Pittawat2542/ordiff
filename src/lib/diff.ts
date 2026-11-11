import type { DiffSection } from "../types";

export function changeCounts(sections: DiffSection[]) {
  return sections.reduce(
    (counts, section) => {
      for (const line of section.lines || []) {
        if (line.type === "add") counts.add++;
        if (line.type === "remove") counts.remove++;
      }
      return counts;
    },
    { add: 0, remove: 0 },
  );
}
