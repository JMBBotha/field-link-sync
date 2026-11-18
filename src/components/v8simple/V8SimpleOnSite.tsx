import { useState } from "react";
import { Link } from "react-router-dom";
import { V8_QUOTE_OPTIONS } from "@/lib/v8simple/quote";
import { v8Checklist, v8JobDoneReady, v8TechPush } from "@/lib/v8simple/onsite";
import { v8SchedulePack } from "@/lib/v8simple/schedule";

const JOB = { type: "Installation", area: "Gardens", time: "09:00", clientName: "Demo client F" };

export function V8SimpleOnSite({ kind = "install" }: { kind?: "install" | "service" }) {
  const items = v8Checklist(kind);
  const [checks, setChecks] = useState(items.map(() => false));
  const [photos, setPhotos] = useState(0);
  const [signed, setSigned] = useState(false);
  const [part, setPart] = useState(false);
  const ready = v8JobDoneReady({ checks, photos, signed });
  const pack = v8SchedulePack(V8_QUOTE_OPTIONS[0].lines);
  return (
    <article data-testid="v8-on-site" data-kind={kind}>
      <p className="rh-eyebrow">{v8TechPush(JOB)}</p>
      <h1 className="v8s-h1">On site</h1>
      <p className="rh-muted">{JOB.time} · {JOB.type} · {JOB.area}</p>
      <ul>
        {items.map((label, index) => (
          <li key={label}>
            <label><input type="checkbox" checked={checks[index]} onChange={() => setChecks((all) => all.map((on, i) => i === index ? !on : on))} /> {label}</label>
          </li>
        ))}
      </ul>
      {kind === "install" ? (
        <ul data-testid="v8-onsite-pack">{pack.map((line) => <li key={line.name}>{line.qty} × {line.name}</li>)}</ul>
      ) : (
        <p data-testid="v8-consumables">Consumables: R410 or R32. The call-out stays its own line.</p>
      )}
      <button type="button" data-testid="v8-photo" onClick={() => setPhotos((n) => Math.min(2, n + 1))}>Add photo ({photos}/2)</button>
      <label><input type="checkbox" data-testid="v8-sign" checked={signed} onChange={() => setSigned((on) => !on)} /> Client signed</label>
      <button type="button" className="v8s-ghost" data-testid="v8-needs-part" onClick={() => setPart(true)}>Needs a part</button>
      {part && <p data-testid="v8-part-note">Asked the office for a part. No client name was sent.</p>}
      <button type="button" className="v8s-next" data-orange="main" data-testid="v8-job-done" disabled={!ready}>Job done</button>
    </article>
  );
}

export function TechHomeCard() {
  return (
    <section className="rh-card" data-testid="v8-tech-next">
      <div className="rh-frost" aria-hidden />
      <div className="rh-body">
        <p className="rh-eyebrow">Next job</p>
        <h1 className="v8s-h1">{JOB.time}</h1>
        <p>{JOB.type} · {JOB.area}</p>
        <p className="rh-muted">Parts: pack list on the job. No money on this screen.</p>
        <Link to="on-site" className="v8s-next" data-orange="main" data-testid="v8-start-job">Start job</Link>
      </div>
    </section>
  );
}
