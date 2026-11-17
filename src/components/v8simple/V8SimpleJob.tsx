import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { WorkIntent } from "@/components/jobs/BookJobForm";
import { DOING_CHOICES, planPastSave, type Doing } from "@/lib/bookJobPath";
import { V8_DEMO_JOBS } from "@/lib/v8simple/demoJobs";
import { V8_DOTS, v8DotIndex, v8NextStep, v8Stage } from "@/lib/v8simple/stage";
import { usePreviewRole } from "./V8SimpleShell";

/** One job. The orange button is the next step. A past visit reuses the existing quiet save. */
export function V8SimpleJob() {
  const { id } = useParams();
  const role = usePreviewRole();
  const row = V8_DEMO_JOBS.find((job) => job.id === id);
  const [doing, setDoing] = useState<Doing>("upcoming");
  const [note, setNote] = useState<string | null>(null);
  if (!row) {
    return (
      <section className="rh-card">
        <div className="rh-frost" aria-hidden />
        <div className="rh-body">
          <h1 className="v8s-h1">Job not in the preview</h1>
          <Link to="..">Back to jobs</Link>
        </div>
      </section>
    );
  }
  const stage = v8Stage(row.input);
  const step = v8NextStep(stage, role);
  const dot = v8DotIndex(stage);
  const quiet = doing === "upcoming" ? null : planPastSave({
    doing,
    visitKinds: ["ac_installation"],
    existingJobId: row.id,
    completed: false,
    date: "2026-11-16",
    today: "2026-11-17",
    role: { isAdmin: role === "admin" },
    visitId: doing === "correct" ? "visit-demo" : null,
  });
  return (
    <article data-testid="v8-job" data-stage={stage.key}>
      <ol className="v8s-dots" data-testid="v8-dots">
        {V8_DOTS.map((label, index) => (
          <li key={label} className={index < dot || stage.key === "paid" && index === dot ? "is-done" : index === dot ? "is-now" : ""}>
            <i />
            <span>{label}</span>
          </li>
        ))}
      </ol>
      <section className="rh-card">
        <div className="rh-frost" aria-hidden />
        <div className="rh-body">
          <p className="rh-eyebrow">{stage.label}</p>
          <h1 className="v8s-h1">{row.client}</h1>
          <p className="rh-muted">{row.work} · {row.area}</p>
          {role !== "tech" && row.quoteNo && <p className="rh-muted">Quote {row.quoteNo}</p>}
          {role === "tech" && <p className="rh-muted">No money totals on this screen.</p>}
          <button
            type="button"
            className="v8s-next"
            data-orange="main"
            data-testid="v8-next-step"
            disabled={!step.enabled}
            onClick={() => setNote("Preview only. Nothing was sent to the client, and no rep was alerted.")}
          >
            {step.label}
          </button>
          {note && <p data-testid="v8-next-note">{note}</p>}
        </div>
      </section>
      {role !== "tech" && (
        <section data-testid="v8-past-visit">
          <WorkIntent value={doing} onChange={setDoing} />
          <p className="rh-muted" data-testid="v8-past-quiet">
            {DOING_CHOICES.find((choice) => choice.id === "past")?.hint}
            {quiet ? ` This save uses ${quiet.rpc}.` : ""}
          </p>
        </section>
      )}
    </article>
  );
}
