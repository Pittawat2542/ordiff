import { useState } from "react";
import { sections, groups } from "../sample-data";
import { DiffView } from "../diff-view";
import { Button } from "./ui/button";

/** Isolated illustrative history: never publishes to the real repository backend. */
export function SampleCycle() {
  const [pass, setPass] = useState<"previous" | "current">("previous");
  const [resolved, setResolved] = useState(false),
    [accepted, setAccepted] = useState(false);
  const current = sections[0];
  const previous = {
    ...current,
    id: "sample-previous-status",
    lines: current.lines?.filter((line) => !line.text.includes("error:")),
  };
  return (
    <div className="sample-cycle">
      <p>
        This offline example shows a second review pass. It is isolated from
        your repositories and does not publish feedback.
      </p>
      <div className="cycle-actions">
        <Button variant="secondary" onClick={() => setPass("previous")}>
          Pass 1 · Previous snapshot
        </Button>
        <Button variant="secondary" onClick={() => setPass("current")}>
          Pass 2 · Current snapshot
        </Button>
      </div>
      <p>
        {pass === "previous"
          ? "Historical view · Read only · Previously reviewed"
          : "Modified since pass 1 · Requires fresh review confirmation"}
      </p>
      <DiffView
        section={pass === "previous" ? previous : current}
        version={pass === "previous" ? "example-pass-1" : "example-pass-2"}
      />
      <section>
        <h3>Needs another look</h3>
        <p>
          Retry policy · Deferred: verify the retry limit with its tests.
          Deferred work does not count as reviewed.
        </p>
      </section>
      <section>
        <h3>Change · Selected-line feedback</h3>
        <p>pipeline/serialize.ts · After · L17</p>
        <blockquote>status: run.state,</blockquote>
        <p>
          Include the failure explanation so the interface can tell the user
          what happened.
        </p>
        <strong>
          {resolved
            ? "Resolved by you"
            : "Addressed · Awaiting your verification"}
        </strong>
        <p>
          Agent report: Added the error message to the serialized result. Review
          the new line in Pass 2 before resolving.
        </p>
        <Button
          variant="secondary"
          onClick={() => {
            setPass("current");
            setResolved((value) => !value);
          }}
        >
          {resolved
            ? "Reopen example feedback"
            : "Verify and resolve example feedback"}
        </Button>
      </section>
      <section>
        <h3>
          {accepted ? "Accepted example reading path" : "Pending plan proposal"}
        </h3>
        <p>
          Read the data contract, UI, and tests together. Accepting changes the
          reading order and preserves human review decisions.
        </p>
        <ol>
          {groups.slice(0, 2).map((group) => (
            <li key={group.id}>
              {group.title} · {group.sections.length} sections
            </li>
          ))}
        </ol>
        <Button
          variant="secondary"
          onClick={() => setAccepted((value) => !value)}
        >
          {accepted
            ? "Restore previous example plan"
            : "Accept example proposal"}
        </Button>
      </section>
    </div>
  );
}
