/** Demo shots for Book a job. Harness rows only — not live clients. */
import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { BookJobForm, HouseFirstFitLine, VisitList, WorkIntent, type PastDraft, type VisitView } from "@/components/jobs/BookJobForm";
import { applyCorrection, defaultCompleted, houseAttachPlan, johannesburgToday, titleDefault, withFirstFit, workCards, type Doing, type VisitKind, type WhereMode } from "@/lib/bookJobPath";
import type { JobKind } from "@/lib/jobTypeChoice";

const PROJECTS = [{ id: "p-avec", name: "Avec" }];
const HOUSES = [{ id: "h12", house_no: "12" }, { id: "h13", house_no: "13" }];
const TECHS = [{ id: "t1", name: "Tech A" }, { id: "t2", name: "Tech B" }];
const JOBS = [{ id: "job-12", title: "Installation — Avec House 12", description: null, customer_id: "demo-client", job_type: "installation", quote_id: null, lead_id: null }];
const SAVED: VisitView = { id: "v1", techId: "t1", tech: "Tech A", date: "2026-11-03", arrive: "08:00", leave: "11:30", note: "First fix", kind: "first_fix" };

function emptyPast(): PastDraft {
  return { techId: "", date: johannesburgToday(), arrive: "08:00", leave: "", note: "", completed: defaultCompleted("first_fix") };
}

function DemoClassic() {
  return (
    <div className="space-y-3" data-testid="demo-classic">
      <label className="block text-sm font-medium">Customer <span className="text-destructive">*</span>
        <select className="mt-1 h-11 w-full rounded-lg border bg-background px-3" defaultValue="demo"><option value="demo">Demo client</option></select>
      </label>
      <label className="block text-sm font-medium">Address <span className="text-destructive">*</span>
        <input className="mt-1 h-11 w-full rounded-lg border bg-background px-3" readOnly value="14 Demo Lane" />
      </label>
      <div className="rounded-lg border bg-muted/30 p-3">
        <div className="text-sm font-semibold">Schedule <span className="text-destructive">*</span> <span className="text-xs font-normal uppercase tracking-wide text-muted-foreground">Date · Time · Technician</span></div>
      </div>
    </div>
  );
}

function Frame({ width, children }: { width: number; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#eef6fb] text-[#0F2A44]" data-testid="book-job-harness">
      <header className="flex items-center justify-between px-3 text-white" style={{ height: 48, background: "#3D9BEB" }}>
        <b>Book a job</b>
        <small className="text-[11px] font-semibold">Demo — harness, not live client data</small>
      </header>
      <div className="mx-auto px-3 py-3" style={{ width, maxWidth: "100%" }}>{children}</div>
    </div>
  );
}

export default function BookJobHarness() {
  const [params] = useSearchParams();
  const shot = params.get("shot") || "default";
  const tablet = shot === "tablet";
  const width = tablet ? 768 : 390;
  if (shot === "flow") return <Flow width={width} />;
  if (shot === "saved" || shot === "job") return <JobShot width={width} mode={shot} />;
  if (shot === "house") return <HouseShot width={width} />;
  return <BookShot width={width} shot={shot === "tablet" ? "project" : shot} />;
}

function BookShot({ width, shot }: { width: number; shot: string }) {
  const project = shot === "project" || shot === "past";
  const doing: Doing = shot === "past" ? "past" : "upcoming";
  const attached = project ? houseAttachPlan({ id: "h12", house_no: "12" }, JOBS, "demo-client").job : null;
  const visitKind: VisitKind | null = shot === "past" ? "first_fix" : null;
  const past: PastDraft = shot === "past"
    ? { techId: "t1", date: "2026-11-03", arrive: "08:00", leave: "11:30", note: "First fix", completed: defaultCompleted("first_fix") }
    : emptyPast();
  return (
    <Frame width={width}>
      <div className="mb-3 rounded-2xl bg-white p-3 shadow-sm">
        <h1 className="text-lg font-extrabold">Book a job</h1>
        <p className="text-xs text-muted-foreground">Create New Job — new work, past work, projects, and later corrections.</p>
        {project && <p className="mt-2 text-sm font-semibold">{titleDefault("Avec", "12", visitKind)}</p>}
      </div>
      <div className="rounded-2xl bg-white p-3 shadow-sm">
        <BookJobForm
          where={project ? "project" : "single"}
          onWhere={() => {}}
          doing={doing}
          onDoing={() => {}}
          projects={PROJECTS}
          projectId={project ? "p-avec" : ""}
          onProject={() => {}}
          houses={HOUSES}
          houseId={project ? "h12" : ""}
          onHouse={() => {}}
          clientLabel={project ? "Demo client" : null}
          projectHref={project ? "/dev/book-a-job?shot=house" : null}
          attachedTitle={attached?.title || null}
          cards={workCards(doing, !!attached)}
          jobKind={null}
          onJobKind={() => {}}
          visitKind={visitKind}
          onVisitKind={() => {}}
          canLogPast
          techs={TECHS}
          past={past}
          onPast={() => {}}
          visits={[]}
          correctId={null}
          onCorrect={() => {}}
          classic={doing !== "upcoming" ? null : attached ? <p className="text-sm text-muted-foreground">Next visit uses this job's schedule. No second job.</p> : <DemoClassic />}
        />
        {shot === "past" && <p className="mt-3 text-xs text-muted-foreground">Past dates are allowed. Saving writes one visit and does not message the client.</p>}
      </div>
    </Frame>
  );
}

function JobShot({ width, mode }: { width: number; mode: "saved" | "job" }) {
  const [doing, setDoing] = useState<Doing>(mode === "job" ? "upcoming" : "past");
  return (
    <Frame width={width}>
      <div className="mb-3 rounded-2xl bg-gradient-to-br from-[#0F2A44] to-[#1590D6] p-4 text-white">
        <p className="text-xs">Demo job · harness</p>
        <h1 className="text-xl font-semibold">Installation — Avec House 12</h1>
        <p className="text-sm text-[#CFE6F6]">Demo client · Avec House 12</p>
      </div>
      <div className="rounded-2xl bg-white p-3 shadow-sm" data-testid="job-work-shot">
        <h2 className="text-sm font-semibold">Book, log, or correct</h2>
        <p className="mb-2 text-xs text-muted-foreground">Same choices as Book a job. Not only under Add on behalf of tech.</p>
        <WorkIntent value={doing} onChange={setDoing} />
        {mode === "saved" && <div className="mt-3"><VisitList visits={[SAVED]} /></div>}
        <p className="mt-3 text-xs text-muted-foreground">Add on behalf of tech stays on this job for photos, serials, and materials.</p>
      </div>
    </Frame>
  );
}

function HouseShot({ width }: { width: number }) {
  const steps = useMemo(() => withFirstFit([{ step_key: "first_fit", done: false, label: "First fit (sleeves & drains)" }, { step_key: "piping", done: false, label: "Install piping" }], [SAVED]), []);
  const fit = steps.find((s) => s.step_key === "first_fit");
  return (
    <Frame width={width}>
      <div className="mb-3 rounded-2xl bg-white p-3 shadow-sm">
        <p className="text-xs text-muted-foreground">Avec · demo house</p>
        <h1 className="text-xl font-semibold">House 12</h1>
      </div>
      <div className="space-y-3 rounded-2xl bg-white p-3 shadow-sm" data-testid="house-work-shot">
        <HouseFirstFitLine done={!!fit?.done} inStep={!!fit?.done} />
        <div className="rounded-xl border p-3 text-sm">
          <div className="mb-1 font-semibold">Done ticks</div>
          {steps.map((s) => <label key={s.step_key} className="flex items-center gap-2 py-1"><input type="checkbox" readOnly checked={s.done} /> {s.label}</label>)}
        </div>
        <h2 className="text-sm font-semibold">Book, log, or correct</h2>
        <WorkIntent value="past" onChange={() => {}} />
        <p className="text-sm" data-testid="attached-job">Attached to Installation — Avec House 12. No new sale and no second job.</p>
        <VisitList visits={[SAVED]} />
      </div>
    </Frame>
  );
}

function Flow({ width }: { width: number }) {
  const [where, setWhere] = useState<WhereMode>("single");
  const [doing, setDoing] = useState<Doing>("upcoming");
  const [projectId, setProjectId] = useState("");
  const [houseId, setHouseId] = useState("");
  const [jobKind, setJobKind] = useState<JobKind | null>(null);
  const [visitKind, setVisitKind] = useState<VisitKind | null>(null);
  const [past, setPast] = useState<PastDraft>(emptyPast());
  const [visits, setVisits] = useState<VisitView[]>([]);
  const [saved, setSaved] = useState(false);
  const attached = where === "project" && houseId === "h12" ? houseAttachPlan({ id: "h12", house_no: "12" }, JOBS, "demo-client").job : null;
  const onVisit = (k: VisitKind) => { setVisitKind(k); if (k === "first_fix") setPast((p) => ({ ...p, completed: false })); };
  const save = () => {
    if (doing === "correct" && visits[0]) {
      const next = applyCorrection({
        id: visits[0].id, jobId: "job-12", techId: past.techId, techName: "Tech A", date: past.date, arrive: past.arrive, leave: past.leave, note: past.note, completed: past.completed, kind: visitKind,
      }, { note: past.note, date: past.date, kind: visitKind });
      setVisits([{ ...visits[0], note: next.note, date: next.date, kind: next.kind }]);
      return;
    }
    const row: VisitView = { id: "v1", techId: past.techId, tech: TECHS.find((t) => t.id === past.techId)?.name || "Tech A", date: past.date, arrive: past.arrive, leave: past.leave, note: past.note || "First fix", kind: visitKind };
    setVisits([row]);
    setSaved(true);
  };
  if (saved) return <JobShot width={width} mode="saved" />;
  return (
    <Frame width={width}>
      <div className="rounded-2xl bg-white p-3 shadow-sm">
        <BookJobForm
          where={where} onWhere={setWhere} doing={doing} onDoing={setDoing}
          projects={PROJECTS} projectId={projectId} onProject={(id) => { setProjectId(id); setHouseId(""); }}
          houses={HOUSES} houseId={houseId} onHouse={setHouseId}
          clientLabel={where === "project" && projectId ? "Demo client" : null}
          projectHref={houseId ? "/dev/book-a-job?shot=house" : null}
          attachedTitle={attached?.title || null}
          cards={workCards(doing, !!attached)}
          jobKind={jobKind} onJobKind={setJobKind}
          visitKind={visitKind} onVisitKind={onVisit}
          canLogPast techs={TECHS} past={past} onPast={setPast}
          visits={visits} correctId={null} onCorrect={() => {}}
          classic={doing === "upcoming" ? <DemoClassic /> : null}
        />
        <button type="button" className="mt-3 h-11 w-full rounded-xl bg-[#C2410C] font-semibold text-white" data-testid="harness-save" onClick={save}>Save visit</button>
      </div>
    </Frame>
  );
}
