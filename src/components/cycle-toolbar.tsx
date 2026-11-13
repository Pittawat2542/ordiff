import { SampleCycle } from "./sample-cycle";
import { useEffect, useState } from "react";
import type { ReviewController } from "../hooks/use-review";
import type { ComparisonSpec, ReviewGroup, Workspace } from "../types";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { NativeDialog } from "./dialogs";
import { DiffView } from "../diff-view";
import { cycleRequest } from "../lib/cycle-client";
export function CycleToolbar({ review }: { review: ReviewController }) {
  const w = review.workspace;
  const [deleteName, setDeleteName] = useState("");
  const [dialog, setDialog] = useState<
      | "comparison"
      | "history"
      | "groups"
      | "proposal"
      | "storage"
      | "sample"
      | null
    >(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<ComparisonSpec["kind"]>("working-tree"),
    [before, setBefore] = useState(""),
    [after, setAfter] = useState("HEAD");
  const [refs, setRefs] = useState<
      { name: string; oid: string; subject: string }[]
    >([]),
    [commits, setCommits] = useState<{ oid: string; subject: string }[]>([]);
  const [groups, setGroups] = useState<ReviewGroup[]>([]),
    [expectedPlan, setExpectedPlan] = useState(0),
    [historical, setHistorical] = useState<Workspace | null>(null),
    [historySection, setHistorySection] = useState(0);
  const [proposalId, setProposalId] = useState(""),
    [dragged, setDragged] = useState<number | null>(null);
  useEffect(() => {
    setDialog(null);
    setHistorical(null);
  }, [w?.comparisonId]);
  useEffect(() => {
    if (dialog !== "comparison" || !w?.repositoryId) return;
    const abort = new AbortController();
    void Promise.all([
      fetch(`/api/repositories/${w.repositoryId}/refs?limit=500`, {
        signal: abort.signal,
      }).then((r) => r.json()),
      fetch(`/api/repositories/${w.repositoryId}/commits?limit=100`, {
        signal: abort.signal,
      }).then((r) => r.json()),
    ])
      .then(([a, b]) => {
        setRefs(a.items || []);
        setCommits(b.items || []);
        if (!before) {
          const names = (a.items || []).map((r: { name: string }) => r.name);
          setBefore(
            names.some((name: string) => name.endsWith("/HEAD"))
              ? names.find((name: string) => name.endsWith("/HEAD"))
              : names.includes("main")
                ? "main"
                : names.includes("master")
                  ? "master"
                  : "",
          );
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [dialog, w?.repositoryId]);
  if (!w) return null;
  const cycle = w.cycle;
  const label =
    !w.comparison || w.comparison.kind === "working-tree"
      ? "Working changes"
      : w.comparison.kind === "branch"
        ? `${w.comparison.baseRef} … ${w.comparison.headRef}`
        : `${w.comparison.beforeRef.slice(0, 12)} → ${w.comparison.afterRef.slice(0, 12)}`;
  async function perform(task: () => Promise<unknown>) {
    setError("");
    setBusy(true);
    try {
      await task();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not complete this action.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function post(path: string, body: unknown) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed.");
    return data;
  }
  function open(which: typeof dialog) {
    setError("");
    setDialog(which);
    if (which === "groups") {
      setGroups(structuredClone(w!.groups));
      setExpectedPlan(cycle?.pass.planRevision || 0);
    }
    if (which === "proposal") setExpectedPlan(cycle?.pass.planRevision || 0);
    if (which === "comparison") setKind(w!.comparison?.kind || "working-tree");
  }
  function move(index: number, direction: number) {
    const next = [...groups],
      target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setGroups(next);
  }
  function update(index: number, patch: Partial<ReviewGroup>) {
    setGroups((current) =>
      current.map((g, i) => (i === index ? { ...g, ...patch } : g)),
    );
  }
  const proposal =
    cycle?.proposals.find((p) => p.id === proposalId) || cycle?.proposals[0];
  return (
    <>
      <div className="cycle-toolbar" aria-label="Comparison and review history">
        <Button
          variant="link"
          disabled={!cycle}
          onClick={() => open("comparison")}
        >
          {label}
        </Button>
        {w.repo.source === "demo" && (
          <Button variant="link" onClick={() => open("sample")}>
            Explore a review cycle
          </Button>
        )}
        {cycle && (
          <>
            <Button variant="link" onClick={() => open("history")}>
              Pass {cycle.history.length} · History
            </Button>
            <Button variant="link" onClick={() => open("groups")}>
              Organize behaviors
            </Button>
            <Button variant="link" onClick={() => open("storage")}>
              Review storage
            </Button>
          </>
        )}
      </div>
      {cycle && cycle.latestSnapshotId !== w.version && (
        <div className="cycle-notice" role="status">
          <span>Changes available. Your current review is preserved.</span>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void perform(() => review.refreshDiff())}
          >
            Review update
          </Button>
        </div>
      )}
      {!!cycle?.proposals.length && (
        <div className="cycle-notice">
          <span>
            {cycle.proposals.length} proposed reading{" "}
            {cycle.proposals.length === 1 ? "path" : "paths"}
          </span>
          <Button
            variant="link"
            onClick={() => {
              setProposalId(cycle.proposals[0].id);
              open("proposal");
            }}
          >
            Preview proposal
          </Button>
        </div>
      )}
      <NativeDialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        titleId="cycle-dialog-title"
        className="sheet-dialog cycle-dialog"
      >
        <header>
          <div>
            <p className="eyebrow">YOUR LOCAL REVIEW WORKSPACE</p>
            <h2 id="cycle-dialog-title">
              {dialog === "sample"
                ? "Example review cycle"
                : dialog === "comparison"
                  ? "Choose comparison"
                  : dialog === "history"
                    ? "Review history"
                    : dialog === "groups"
                      ? "Organize behaviors"
                      : dialog === "proposal"
                        ? "Proposed reading path"
                        : "Review storage"}
            </h2>
          </div>
          <Button variant="secondary" onClick={() => setDialog(null)}>
            Close
          </Button>
        </header>
        {dialog === "sample" && <SampleCycle />}
        {error && (
          <p role="alert" className="feedback-warning">
            {error}
          </p>
        )}
        {dialog === "comparison" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void perform(async () => {
                const spec: ComparisonSpec =
                  kind === "working-tree"
                    ? { kind }
                    : kind === "branch"
                      ? { kind, baseRef: before, headRef: after }
                      : { kind, beforeRef: before, afterRef: after };
                const data = await post("/api/comparisons", { spec });
                review.applyWorkspace(data.workspace);
                setDialog(null);
              });
            }}
          >
            <label>
              Compare
              <select
                value={kind}
                onChange={(e) =>
                  setKind(e.target.value as ComparisonSpec["kind"])
                }
              >
                <option value="working-tree">Working changes</option>
                <option value="branch">Branch changes since merge-base</option>
                <option value="commits">Between commits</option>
              </select>
            </label>
            {kind !== "working-tree" && (
              <>
                <label>
                  {kind === "branch" ? "Base branch" : "Before commit"}
                  <Input
                    required
                    list="comparison-refs"
                    value={before}
                    onChange={(e) => setBefore(e.target.value)}
                  />
                </label>
                <label>
                  {kind === "branch" ? "Head branch" : "After commit"}
                  <Input
                    required
                    list="comparison-refs"
                    value={after}
                    onChange={(e) => setAfter(e.target.value)}
                  />
                </label>
                <datalist id="comparison-refs">
                  {refs.map((r) => (
                    <option key={r.name} value={r.name}>
                      {r.oid.slice(0, 8)} · {r.subject}
                    </option>
                  ))}
                  {kind === "commits" &&
                    commits.map((c) => (
                      <option key={c.oid} value={c.oid}>
                        {c.subject}
                      </option>
                    ))}
                </datalist>
              </>
            )}
            <p className="field-hint">
              Uses local refs and already-fetched remote branches. Ordiff never
              fetches or edits Git files.
            </p>
            <Button type="submit" disabled={busy}>
              {busy ? "Capturing…" : "Open comparison"}
            </Button>
          </form>
        )}
        {dialog === "history" && cycle && (
          <>
            <p>
              Each pass requires fresh review decisions. Previous decisions
              remain in history.
            </p>
            <div className="history-list">
              {cycle.history
                .slice()
                .reverse()
                .map((p, index) => (
                  <Button
                    key={p.id}
                    variant="secondary"
                    disabled={!p.available || busy}
                    onClick={() =>
                      void perform(async () => {
                        const response = await fetch(
                          `/api/snapshots/${p.snapshotId}?limit=500`,
                        );
                        const data = await response.json();
                        if (!response.ok) throw new Error(data.error);
                        setHistorical(data);
                        setHistorySection(0);
                      })
                    }
                  >
                    Pass {cycle.history.length - index} ·{" "}
                    {new Date(p.createdAt).toLocaleString()} · {p.reviewed}{" "}
                    reviewed{!p.available ? " · Source cleared" : ""}
                  </Button>
                ))}
            </div>
            {historical && (
              <section className="history-preview">
                <p className="plan-notice">
                  Historical snapshot · Read only ·{" "}
                  {historical.version.slice(0, 8)}
                </p>
                <select
                  aria-label="Historical section"
                  value={historySection}
                  onChange={(e) => setHistorySection(Number(e.target.value))}
                >
                  {historical.sections.map((s, i) => (
                    <option value={i} key={s.id}>
                      {s.path} · {s.symbol}
                    </option>
                  ))}
                </select>
                {historical.sections[historySection] && (
                  <DiffView
                    section={historical.sections[historySection]}
                    version={historical.version}
                  />
                )}
              </section>
            )}
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await review.cycleAction("pass.restart");
                  setDialog(null);
                })
              }
            >
              Start a new pass
            </Button>
          </>
        )}
        {dialog === "groups" && (
          <>
            <p>
              Arrange sections in a useful reading order. A section may appear
              in several behaviors; progress counts it once.
            </p>
            {!!cycle?.pass.planHistory.length && (
              <label>
                Restore earlier reading order
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const previous = cycle.pass.planHistory.find(
                      (p) => String(p.revision) === e.target.value,
                    );
                    if (previous) setGroups(structuredClone(previous.groups));
                  }}
                >
                  <option value="">Choose a saved revision…</option>
                  {cycle.pass.planHistory.map((p) => (
                    <option key={p.revision} value={p.revision}>
                      Revision {p.revision} · {p.groups.length} behaviors
                    </option>
                  ))}
                </select>
              </label>
            )}
            {groups.map((g, index) => (
              <section
                className="behavior-editor"
                key={g.id}
                draggable
                onDragStart={() => setDragged(index)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragged === null) return;
                  const next = [...groups];
                  const [item] = next.splice(dragged, 1);
                  next.splice(index, 0, item);
                  setGroups(next);
                  setDragged(null);
                }}
              >
                <label>
                  Behavior title
                  <Input
                    value={g.title}
                    maxLength={160}
                    onChange={(e) => update(index, { title: e.target.value })}
                  />
                </label>
                <label>
                  Description
                  <Textarea
                    value={g.description}
                    maxLength={1000}
                    onChange={(e) =>
                      update(index, { description: e.target.value })
                    }
                  />
                </label>
                <div className="cycle-actions">
                  <Button
                    variant="link"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    Move up
                  </Button>
                  <Button
                    variant="link"
                    disabled={index === groups.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    Move down
                  </Button>
                  <Button
                    variant="link"
                    onClick={() =>
                      setGroups(groups.filter((x) => x.id !== g.id))
                    }
                  >
                    Delete behavior
                  </Button>
                </div>
                <ol>
                  {g.sections.map((id, position) => {
                    const section = w.sections.find((s) => s.id === id);
                    return (
                      <li key={id}>
                        <strong>{section?.path}</strong>
                        <span>{section?.symbol}</span>
                        <div className="cycle-actions">
                          <Button
                            variant="link"
                            disabled={position === 0}
                            onClick={() => {
                              const ids = [...g.sections];
                              [ids[position - 1], ids[position]] = [
                                ids[position],
                                ids[position - 1],
                              ];
                              update(index, { sections: ids });
                            }}
                          >
                            Move section up
                          </Button>
                          <Button
                            variant="link"
                            disabled={position === g.sections.length - 1}
                            onClick={() => {
                              const ids = [...g.sections];
                              [ids[position + 1], ids[position]] = [
                                ids[position],
                                ids[position + 1],
                              ];
                              update(index, { sections: ids });
                            }}
                          >
                            Move section down
                          </Button>
                          <Button
                            variant="link"
                            onClick={() => {
                              const explanations = { ...g.explanations };
                              delete explanations[id];
                              update(index, {
                                sections: g.sections.filter((x) => x !== id),
                                explanations,
                              });
                            }}
                          >
                            Remove section
                          </Button>
                        </div>
                        <label>
                          Explanation
                          <Textarea
                            value={g.explanations?.[id] || ""}
                            maxLength={2000}
                            onChange={(e) =>
                              update(index, {
                                explanations: {
                                  ...g.explanations,
                                  [id]: e.target.value,
                                },
                              })
                            }
                          />
                        </label>
                      </li>
                    );
                  })}
                </ol>
                <label>
                  Add section
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value)
                        update(index, {
                          sections: [...g.sections, e.target.value],
                        });
                    }}
                  >
                    <option value="">Choose a section…</option>
                    {w.sections
                      .filter((s) => !g.sections.includes(s.id))
                      .map((s) => (
                        <option value={s.id} key={s.id}>
                          {s.path} · {s.symbol}
                        </option>
                      ))}
                  </select>
                </label>
              </section>
            ))}
            <div className="cycle-actions">
              <Button
                variant="secondary"
                onClick={() =>
                  setGroups([
                    ...groups,
                    {
                      id: crypto.randomUUID(),
                      title: "New behavior",
                      description: "",
                      sections: [],
                      explanations: {},
                    },
                  ])
                }
              >
                Add behavior
              </Button>
              <Button
                disabled={busy || groups.some((g) => !g.title.trim())}
                onClick={() =>
                  void perform(async () => {
                    await review.cycleAction("plan.save", {
                      groups,
                      expectedRevision: expectedPlan,
                    });
                    setDialog(null);
                  })
                }
              >
                Save reading order
              </Button>
            </div>
          </>
        )}
        {dialog === "proposal" && proposal && (
          <>
            <p>
              Accepting replaces the reading order. Comments and review
              decisions are preserved.{" "}
              {proposal.snapshotId !== w.version
                ? "This proposal uses a newer snapshot; accepting starts a new review pass."
                : ""}
            </p>
            {cycle!.proposals.length > 1 && (
              <select
                aria-label="Plan proposal"
                value={proposal.id}
                onChange={(e) => setProposalId(e.target.value)}
              >
                {cycle!.proposals.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.groups.map((g) => g.title).join(", ")}
                  </option>
                ))}
              </select>
            )}
            <ol>
              {proposal.groups.map((g) => (
                <li key={g.id}>
                  <strong>{g.title}</strong>
                  <p>{g.description}</p>
                  <p>{g.sections.length} sections</p>
                </li>
              ))}
            </ol>
            <p>
              {new Set(proposal.groups.flatMap((g) => g.sections)).size}{" "}
              sections covered. Uncovered sections stay visible.
            </p>
            <div className="cycle-actions">
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    await review.cycleAction("plan.dismiss", {
                      id: proposal.id,
                    });
                    setDialog(null);
                  })
                }
              >
                Dismiss
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    let current = w;
                    if (proposal.snapshotId !== w.version) {
                      const data = await post(
                        `/api/comparisons/${w.comparisonId}/activate`,
                        {
                          snapshotId: proposal.snapshotId,
                          expectedPassId: cycle!.pass.id,
                        },
                      );
                      current = data.workspace;
                      review.applyWorkspace(current);
                    }
                    const data = await cycleRequest(current, "plan.accept", {
                      id: proposal.id,
                      expectedRevision:
                        proposal.snapshotId === w.version
                          ? expectedPlan
                          : current.cycle!.pass.planRevision,
                    });
                    review.applyWorkspace(data.workspace);
                    setDialog(null);
                  })
                }
              >
                Accept reading path
              </Button>
            </div>
          </>
        )}
        {dialog === "storage" && cycle && (
          <>
            <p>
              {cycle.storage.snapshots} retained snapshots ·{" "}
              {(cycle.storage.bytes / 1048576).toFixed(1)} MiB
            </p>
            <p>
              Historical source is stored locally. Clearing source keeps
              comments, batches, and review records.
            </p>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void perform(() => review.cycleAction("storage.clear"))
              }
            >
              Clear historical source
            </Button>
            <details>
              <summary>Delete repository review data</summary>
              <p>
                This deletes saved feedback, batches, plans, and review history
                for {w.repo.name}. Git files stay untouched. Type the repository
                name to confirm.
              </p>
              <Input
                aria-label="Confirm repository name"
                value={deleteName}
                onChange={(e) => setDeleteName(e.target.value)}
              />
              <Button
                variant="secondary"
                disabled={busy || deleteName !== w.repo.name}
                onClick={() =>
                  void perform(async () => {
                    await review.cycleAction("storage.reset", {
                      confirmRepository: deleteName,
                    });
                    setDeleteName("");
                    setDialog(null);
                  })
                }
              >
                Delete review data
              </Button>
            </details>
            <h3>Published feedback</h3>
            {cycle.batches.length ? (
              cycle.batches.map((b) => (
                <div className="cycle-notice" key={b.id}>
                  <span>
                    {b.count} comments ·{" "}
                    {new Date(b.createdAt).toLocaleString()} · {b.status}
                  </span>
                  {b.status === "published" && (
                    <Button
                      variant="link"
                      onClick={() =>
                        void perform(() =>
                          review.cycleAction("batch.revoke", { id: b.id }),
                        )
                      }
                    >
                      Revoke access
                    </Button>
                  )}
                </div>
              ))
            ) : (
              <p>No published batches yet.</p>
            )}
            <p className="field-hint">
              Revocation prevents future retrieval; it cannot erase content an
              agent already read.
            </p>
          </>
        )}
      </NativeDialog>
    </>
  );
}
