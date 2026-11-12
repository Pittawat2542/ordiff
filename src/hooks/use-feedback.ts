import { useEffect, useRef, useState } from "react";
import {
  captureSection,
  createFeedback,
  feedbackFiles,
  reduceFeedback,
} from "../feedback";
import type {
  DiffSection,
  FeedbackAction,
  FeedbackComment,
  FeedbackState,
  ReviewState,
  Workspace,
} from "../types";

export function useFeedback(workspace: Workspace | null, review: ReviewState) {
  const records = useRef(new Map<string, FeedbackState>());
  const [, render] = useState(0);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const key = workspace
    ? `ordiff.feedback.v1.${workspace.repo.source === "demo" ? "demo" : workspace.repo.path}`
    : "";
  if (key && !records.current.has(key)) {
    let saved: unknown;
    try {
      saved = JSON.parse(localStorage.getItem(key) || "null");
    } catch {
      /* Start with recoverable legacy notes. */
    }
    records.current.set(key, createFeedback(saved, workspace, review.notes));
  }
  const state = records.current.get(key) || createFeedback();
  function save(value: FeedbackState) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      setStorageAvailable(false);
    }
  }
  useEffect(() => {
    if (key) save(records.current.get(key)!);
  }, [key]);
  function dispatch(action: FeedbackAction) {
    if (!key) return;
    const next = reduceFeedback(records.current.get(key)!, action);
    records.current.set(key, next);
    save(next);
    render((value) => value + 1);
  }
  function add(section: DiffSection, scope: "file" | "section") {
    const id = crypto.randomUUID();
    dispatch({
      type: "add",
      comment: {
        id,
        path: section.path,
        text: "",
        intent: "change",
        ...(scope === "section"
          ? { section: captureSection(section, workspace!.version) }
          : {}),
      },
    });
    return id;
  }
  function setQuickNote(section: DiffSection, text: string) {
    const id = `legacy-${section.id}`;
    if (records.current.get(key)?.comments.some((comment) => comment.id === id))
      dispatch({ type: "update", id, patch: { text } });
    else
      dispatch({
        type: "add",
        comment: {
          id,
          path: section.path,
          text,
          intent: "note",
          section: captureSection(section, workspace!.version),
        },
      });
  }
  const files = feedbackFiles(state);
  return {
    state,
    files,
    key,
    storageAvailable,
    dispatch,
    add,
    setQuickNote,
    count: files.reduce((sum, file) => sum + file.comments.length, 0),
    update: (
      id: string,
      patch: Partial<Pick<FeedbackComment, "text" | "intent" | "section">>,
    ) => dispatch({ type: "update", id, patch }),
    remove: (id: string) => dispatch({ type: "remove", id }),
    setGeneral: (text: string) => dispatch({ type: "general", text }),
  };
}
export type FeedbackController = ReturnType<typeof useFeedback>;
