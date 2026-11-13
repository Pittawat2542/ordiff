import { useEffect, useRef, useState } from "react";
import type { ReviewController } from "../hooks/use-review";
import { buildPrompt } from "../prompt";
import { feedbackStatus } from "../feedback";
import { Icon } from "../icons";
import { NativeDialog } from "./dialogs";
import { CommentEditor, GeneralInstructions } from "./feedback-panel";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";

export function PromptBuilder({
  review,
  open,
  close,
}: {
  review: ReviewController;
  open: boolean;
  close: () => void;
}) {
  const { feedback, workspace, model, state } = review;
  const [paths, setPaths] = useState<Set<string> | null>(null);
  const [includeGeneral, setIncludeGeneral] = useState(true);
  const [includeResolved, setIncludeResolved] = useState(false);
  const [handoff, setHandoff] = useState("");
  const [expandedFiles, setExpandedFiles] = useState(new Set<string>());
  const [message, setMessage] = useState("");
  const [copyFailed, setCopyFailed] = useState(false);
  const previewRef = useRef<HTMLTextAreaElement>(null);
  const copySequence = useRef(0);
  const selected = feedback.files.filter(
    (file) => paths === null || paths.has(file.path),
  );
  const prompt = workspace
    ? buildPrompt(workspace, feedback.state, {
        paths: selected.map((file) => file.path),
        includeGeneral,
        includeResolved,
      })
    : "";
  useEffect(() => {
    setMessage("");
    setCopyFailed(false);
    copySequence.current++;
  }, [prompt, open]);
  if (!workspace) return null;
  function toggle(path: string) {
    const next = new Set(paths ?? feedback.files.map((file) => file.path));
    next.has(path) ? next.delete(path) : next.add(path);
    setPaths(next);
  }
  async function copy() {
    const sequence = ++copySequence.current;
    try {
      await navigator.clipboard.writeText(prompt);
      if (sequence !== copySequence.current) return;
      setMessage(
        sequence % 2
          ? "Prompt copied. Choose another batch whenever you’re ready."
          : "Prompt copied. Choose another batch whenever you’re ready.\u00a0",
      );
      setCopyFailed(false);
    } catch {
      if (sequence !== copySequence.current) return;
      setMessage(
        "Couldn’t copy automatically. Select the prompt text and copy it manually.",
      );
      setCopyFailed(true);
    }
  }
  function download() {
    try {
      const url = URL.createObjectURL(
        new Blob([prompt], { type: "text/markdown;charset=utf-8" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${workspace!.repo.name.replace(/[^a-zA-Z0-9_-]/g, "-")}-review-feedback.md`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage("Markdown downloaded.");
    } catch {
      setMessage(
        "Couldn’t download. You can copy or select the prompt text instead.",
      );
    }
  }
  return (
    <NativeDialog
      open={open}
      onClose={close}
      titleId="prompt-builder-title"
      className="sheet-dialog prompt-builder"
      id="prompt-builder-dialog"
    >
      <header className="prompt-builder-header">
        <div>
          <p className="eyebrow">FROM REVIEW TO NEXT ITERATION</p>
          <h2 id="prompt-builder-title">Build your next prompt</h2>
          <p>
            Choose the feedback for this batch. Copy it, then choose the next.
          </p>
        </div>
        <Button
          variant="ghost"
          aria-label="Close prompt builder"
          onClick={close}
        >
          <Icon name="close" />
        </Button>
      </header>
      <div className="prompt-builder-body">
        <section className="prompt-selection" aria-label="Feedback selection">
          <div className="prompt-section-heading">
            <h3>
              File feedback{" "}
              <span className="feedback-count">{feedback.files.length}</span>
            </h3>
            <div>
              <Button variant="link" onClick={() => setPaths(null)}>
                Select all
              </Button>
              <Button variant="link" onClick={() => setPaths(new Set())}>
                Clear
              </Button>
            </div>
          </div>
          <p className="field-hint">
            Open and addressed feedback is included by default.
          </p>
          <label>
            <input
              type="checkbox"
              checked={includeResolved}
              onChange={(e) => setIncludeResolved(e.target.checked)}
            />{" "}
            Include resolved feedback
          </label>
          {!feedback.files.length && (
            <p className="prompt-no-files">
              No file comments yet. You can write a general prompt below, or
              return to the diff to add feedback.
            </p>
          )}
          <div className="prompt-files">
            {feedback.files.map((file) => (
              <div
                className={`prompt-file ${paths === null || paths.has(file.path) ? "is-selected" : ""}`}
                key={file.path}
              >
                <label className="prompt-file-label">
                  <input
                    type="checkbox"
                    aria-label={`Include ${file.path}`}
                    checked={paths === null || paths.has(file.path)}
                    onChange={() => toggle(file.path)}
                  />
                  <span>{file.path}</span>
                  <span className="feedback-count">{file.comments.length}</span>
                </label>
                {file.comments.some(
                  (comment) => feedbackStatus(comment, workspace) !== "current",
                ) && (
                  <span className="prompt-stale-label">
                    <Icon name="status" />
                    References need rechecking
                  </span>
                )}
                <details
                  className="prompt-file-details"
                  open={expandedFiles.has(file.path)}
                >
                  <summary
                    onClick={(event) => {
                      event.preventDefault();
                      setExpandedFiles((previous) => {
                        const next = new Set(previous);
                        if (next.has(file.path)) next.delete(file.path);
                        else next.add(file.path);
                        return next;
                      });
                    }}
                  >
                    Edit feedback
                  </summary>
                  <div>
                    {expandedFiles.has(file.path) &&
                      file.comments.map((comment) => (
                        <CommentEditor
                          key={comment.id}
                          comment={comment}
                          feedback={feedback}
                          workspace={workspace}
                          active={model.getActiveSection(state)}
                        />
                      ))}
                  </div>
                </details>
              </div>
            ))}
          </div>
          <div className="prompt-general">
            <label className="include-general">
              <input
                type="checkbox"
                checked={includeGeneral}
                onChange={(event) => setIncludeGeneral(event.target.checked)}
              />
              Include general instructions
            </label>
            <GeneralInstructions feedback={feedback} id="prompt-general-text" />
          </div>
          <p className="feedback-storage-label">
            {feedback.storageAvailable
              ? workspace.cycle
                ? feedback.saveStatus
                : "Feedback is autosaved in this browser."
              : "Feedback is available for this session only."}
          </p>
        </section>
        <section className="prompt-output" aria-label="Generated prompt">
          <div className="prompt-section-heading">
            <h3>Prompt preview</h3>
            <span>
              {selected.length} {selected.length === 1 ? "file" : "files"}
              {includeGeneral && feedback.state.general.trim()
                ? " + general"
                : ""}
            </span>
          </div>
          <Textarea
            ref={previewRef}
            aria-label="Prompt preview"
            readOnly
            spellCheck={false}
            value={prompt}
            placeholder="Select file feedback or write general instructions to build a prompt."
          />
          <span className="prompt-preview-caption">
            Your wording, grouped by file. Ready for your agent.
          </span>
        </section>
      </div>
      <footer className="prompt-builder-footer">
        <div className="prompt-copy-feedback">
          <span role="status" aria-live="polite">
            {message ||
              (prompt
                ? "Each export includes only your current selection."
                : "Add feedback to create a prompt.")}
          </span>
          {copyFailed && (
            <Button
              variant="link"
              onClick={() => {
                previewRef.current?.focus();
                previewRef.current?.select();
              }}
            >
              Select prompt text
            </Button>
          )}
        </div>
        {handoff && (
          <Textarea
            readOnly
            aria-label="Agent handoff instruction"
            value={handoff}
          />
        )}
        <div className="prompt-export-actions">
          {workspace.cycle && (
            <Button
              variant="secondary"
              disabled={!prompt || feedback.saveStatus !== "Saved locally"}
              onClick={() => {
                void review
                  .cycleAction<{ id: string }>("batch.publish", {
                    commentIds: feedback.state.comments
                      .filter(
                        (c) =>
                          selected.some((f) => f.path === c.path) &&
                          (includeResolved || c.status !== "resolved"),
                      )
                      .map((c) => c.id),
                    includeGeneral,
                  })
                  .then((batch) => {
                    setHandoff(
                      `Use Ordiff get_feedback_batch with batchId "${batch.id}". Inspect the captured references and current code, apply the requested changes, then report_feedback_outcomes. Leave resolution to me.`,
                    );
                    setMessage(
                      "Batch published. Future comment edits will not change it.",
                    );
                  })
                  .catch((error) => setMessage(error.message));
              }}
            >
              Publish to MCP
            </Button>
          )}
          <Button variant="secondary" disabled={!prompt} onClick={download}>
            <Icon name="download" />
            Download Markdown
          </Button>
          <Button disabled={!prompt} onClick={() => void copy()}>
            <Icon name="copy" />
            Copy prompt
          </Button>
        </div>
      </footer>
    </NativeDialog>
  );
}
