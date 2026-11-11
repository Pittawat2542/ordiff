import type {
  ReviewAction,
  ReviewDataset,
  ReviewSection,
  ReviewState,
  ReviewStatus,
} from "./types";

export function createReviewModel(dataset: ReviewDataset) {
  const DIFF_VERSION = dataset.version;
  const groups = dataset.groups || [];
  const sections: ReviewSection[] = (dataset.sections || []).map((section) => ({
    ...section,
    checklist: section.checklist || [],
    lines: section.lines || [],
    group:
      groups.find((group) => group.sections.includes(section.id))?.id || null,
  }));
  const sectionById = Object.fromEntries(
    sections.map((section) => [section.id, section]),
  );
  const groupById = Object.fromEntries(
    groups.map((group) => [group.id, group]),
  );
  const guidedOrder = [...new Set(groups.flatMap((group) => group.sections))];

  function createReview(saved?: unknown): ReviewState {
    const candidate =
      saved && typeof saved === "object" ? (saved as Partial<ReviewState>) : {};
    const source = candidate.version === DIFF_VERSION ? candidate : {};
    const reviewed = Array.isArray(source.reviewed)
      ? [...new Set(source.reviewed.filter((id) => sectionById[id]))]
      : [];
    const notes: Record<string, string> = {};
    const checks: Record<string, number[]> = {};
    for (const section of sections) {
      if (typeof source.notes?.[section.id] === "string")
        notes[section.id] = source.notes[section.id].slice(0, 2000);
      if (Array.isArray(source.checks?.[section.id]))
        checks[section.id] = [
          ...new Set(
            source.checks[section.id].filter(
              (index) =>
                Number.isInteger(index) &&
                index >= 0 &&
                index < section.checklist.length,
            ),
          ),
        ];
    }
    let activeId: string | null =
      source.activeId && sectionById[source.activeId]
        ? source.activeId
        : sections[0]?.id || null;
    const groupId =
      source.groupId && groupById[source.groupId]
        ? source.groupId
        : groups[0]?.id || null;
    const view =
      source.view &&
      ["behavior", "all", "ungrouped"].includes(source.view) &&
      (source.view !== "behavior" || groups.length)
        ? source.view
        : groups.length
          ? "behavior"
          : "all";
    if (
      view === "behavior" &&
      !groupById[groupId || ""]?.sections.includes(activeId || "")
    )
      activeId = groupById[groupId || ""]?.sections[0] || null;
    return {
      version: DIFF_VERSION,
      view,
      groupId,
      activeId,
      reviewed,
      notes,
      checks,
      theme: candidate.theme === "dark" ? "dark" : "light",
      query: "",
      filter: "all",
      revisit: false,
    };
  }

  function getActiveSection(state: ReviewState) {
    return sectionById[state.activeId || ""];
  }

  function getProgress(state: ReviewState, groupId: string | null = null) {
    const ids =
      groupId && groupById[groupId]
        ? [...new Set(groupById[groupId].sections)]
        : sections.map((section) => section.id);
    const reviewed = ids.filter((id) => state.reviewed.includes(id)).length;
    return {
      reviewed,
      total: ids.length,
      percent: ids.length ? Math.round((reviewed / ids.length) * 100) : 0,
    };
  }

  function getVisibleSections(state: ReviewState) {
    let visible =
      state.query.trim() || state.view === "all"
        ? sections
        : state.view === "ungrouped"
          ? sections.filter((section) => !section.group)
          : (groupById[state.groupId || ""]?.sections || [])
              .map((id) => sectionById[id])
              .filter(Boolean);
    const query = state.query.trim().toLowerCase();
    if (query)
      visible = visible.filter((section) =>
        [
          section.path,
          section.title,
          section.role,
          section.explanation || "",
          section.group ? groupById[section.group].title : "ungrouped",
          ...section.lines.map((line) => line.text),
        ]
          .join(" ")
          .toLowerCase()
          .includes(query),
      );
    if (state.filter === "reviewed")
      visible = visible.filter((section) =>
        state.reviewed.includes(section.id),
      );
    if (state.filter === "unreviewed")
      visible = visible.filter(
        (section) => !state.reviewed.includes(section.id),
      );
    return visible;
  }

  function reduceReview(state: ReviewState, action: ReviewAction): ReviewState {
    switch (action.type) {
      case "group":
        if (!groupById[action.id]) return state;
        return {
          ...state,
          view: "behavior",
          groupId: action.id,
          activeId: groupById[action.id].sections[0],
          query: "",
          filter: "all",
          revisit: getReviewStatus(state) === "complete",
        };
      case "section": {
        const section = sectionById[action.id];
        if (!section) return state;
        return {
          ...state,
          activeId: section.id,
          groupId: groupById[state.groupId || ""]?.sections.includes(section.id)
            ? state.groupId
            : section.group || state.groupId,
        };
      }
      case "view":
        if (!["all", "ungrouped", "behavior"].includes(action.view))
          return state;
        const visible =
          action.view === "ungrouped"
            ? sections.filter((s) => !s.group)
            : sections;
        return {
          ...state,
          view: action.view,
          query: "",
          activeId: visible[0]?.id || null,
          revisit: getReviewStatus(state) === "complete",
        };
      case "set-reviewed":
        if (!sectionById[action.id]) return state;
        const reviewed = action.reviewed;
        if (state.reviewed.includes(action.id) === reviewed) return state;
        return {
          ...state,
          reviewed: reviewed
            ? [...state.reviewed, action.id]
            : state.reviewed.filter((id) => id !== action.id),
          revisit: false,
        };
      case "note":
        if (!sectionById[action.id]) return state;
        return {
          ...state,
          notes: {
            ...state.notes,
            [action.id]: String(action.text).slice(0, 2000),
          },
        };
      case "check": {
        const section = sectionById[action.id];
        if (
          !section ||
          !Number.isInteger(action.index) ||
          action.index < 0 ||
          action.index >= section.checklist.length
        )
          return state;
        const previous = state.checks[action.id] || [];
        return {
          ...state,
          checks: {
            ...state.checks,
            [action.id]: previous.includes(action.index)
              ? previous.filter((index) => index !== action.index)
              : [...previous, action.index],
          },
        };
      }
      case "next":
      case "previous": {
        const order =
          state.view === "behavior" && !state.query
            ? guidedOrder
            : getVisibleSections(state).map((section) => section.id);
        const index = order.indexOf(state.activeId || "");
        const id = order[index + (action.type === "next" ? 1 : -1)];
        if (!id) return state;
        return {
          ...state,
          activeId: id,
          groupId: sectionById[id].group || state.groupId,
        };
      }
      case "search":
        return { ...state, query: action.query, revisit: true };
      case "filter":
        return ["all", "reviewed", "unreviewed"].includes(action.filter)
          ? { ...state, filter: action.filter, revisit: true }
          : state;
      default:
        return state;
    }
  }

  function getReviewStatus(state: ReviewState): ReviewStatus {
    const progress = getProgress(state);
    return !progress.total
      ? "clean"
      : progress.reviewed === progress.total
        ? "complete"
        : "reviewing";
  }
  return {
    dataset: { ...dataset, groups, sections },
    groups,
    sections,
    groupById,
    sectionById,
    guidedOrder,
    createReview,
    reduceReview,
    getProgress,
    getVisibleSections,
    getActiveSection,
    getReviewStatus,
  };
}
