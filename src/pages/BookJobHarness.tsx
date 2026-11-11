/** Demo shots for Book a job. Harness rows only — not live clients. */
import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { BookJobForm, HouseFirstFitLine, VisitList, WorkIntent, type PastDraft, type VisitView } from "@/components/jobs/BookJobForm";
import { applyCorrection, defaultCompleted, houseAttachPlan, includesFirstFix, johannesburgToday, titleDefault, withFirstFit, workCards, type Doing, type VisitKind, type WhereMode } from "@/lib/bookJobPath";
import type { JobKind } from "@/lib/jobTypeChoice";
import { RequestAlertsSettingsView } from "@/components/settings/RequestAlertsSettingsCard";
import { DEFAULT_REQUEST_ALERTS } from "@/lib/requestOffers";
import { HARNESS_NO_LOGIN_TECHS } from "@/lib/noLoginTechnician";

const PROJECTS = [{ id: "p-avec", name: "Avec" }];
const HOUSES = [{ id: "h12", house_no: "12" }, { id: "h13", house_no: "13" }];
const TECHS = [{ id: "t1", name: "Tech A" }, { id: "t2", name: "Tech B" }];
const JOBS = [{ id: "job-12", title: "Installation — Avec House 12", description: null, customer_id: "demo-client", job_type: "installation", quote_id: null, lead_id: null }];
const SAVED: VisitView = { id: "v1", techId: "t1", tech: "Tech A", date: "2026-11-03", arrive: "08:00", leave: "11:30", note: "", kinds: ["first_fix", "piping"] };

function emptyPast(): PastDraft {
  return { techId: "", date: johannesburgToday(), arrive: "08:00", leave: "", note: "", completed: defaultCompleted([]) };
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

function Frame({ width, title = "Book a job", bar = "#3D9BEB", children }: { width: number; title?: string; bar?: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#eef6fb] text-[#0F2A44]" data-testid="book-job-harness">
      <header className="flex items-center justify-between px-3 text-white" style={{ height: 48, background: bar }}>
        <b>{title}</b>
        <small className="text-[11px] font-semibold">Demo — harness, not live client data</small>
      </header>
      <div className="mx-auto px-3 py-3" style={{ width, maxWidth: "100%" }}>{children}</div>
    </div>
  );
}

export default function BookJobHarness() {
  const [params] = useSearchParams();
  const shot = params.get("shot") || "default";
  const tablet = shot === "tablet" || shot === "kinds-tablet" || shot === "custom-tablet" || shot === "techs-tablet";
  const desktop = params.get("w") === "desktop";
  const width = desktop ? 960 : tablet ? 768 : 390;
  if (shot === "flow") return <Flow width={width} />;
  if (shot === "saved" || shot === "job") return <JobShot width={width} mode={shot} />;
  if (shot === "house") return <HouseShot width={width} />;
  if (shot === "settings") return <SettingsShot width={width} />;
  return <BookShot width={width} shot={shot === "tablet" ? "project" : shot} bar={shot === "nologin" ? "#3D9BE8" : "#3D9BEB"} />;
}

function SettingsShot({ width }: { width: number }) {
  return (
    <Frame width={width} title="Settings">
      <p className="mb-1 text-xs text-muted-foreground">Requests alerts. Same switch as every other page. Demo harness, not live settings.</p>
      <RequestAlertsSettingsView value={{ ...DEFAULT_REQUEST_ALERTS, enabled: true }} onSave={() => {}} />
      <RequestAlertsSettingsView value={{ ...DEFAULT_REQUEST_ALERTS, enabled: false }} onSave={() => {}} />
    </Frame>
  );
}

function BookShot({ width, shot, bar }: { width: number; shot: string; bar?: string }) {
  const customShot = shot === "custom-list" || shot === "custom-typed" || shot === "custom-combo" || shot === "custom-tablet";
  const techsShot = shot === "techs" || shot === "techs-tablet" || shot === "nologin";
  const project = shot === "project" || shot === "past" || shot === "kinds" || shot === "combo" || shot === "kinds-tablet" || customShot;
  const doing: Doing = shot === "past" || shot === "kinds" || shot === "combo" || shot === "kinds-tablet" || customShot || techsShot ? "past" : "upcoming";
  const attached = project ? houseAttachPlan({ id: "h12", house_no: "12" }, JOBS, "demo-client").job : null;
  const visitKinds: VisitKind[] = shot === "custom-typed" ? ["custom"]
    : shot === "custom-combo" || shot === "custom-tablet" ? ["first_fix", "custom"]
    : shot === "past" || shot === "combo" || shot === "kinds-tablet" ? ["first_fix", "piping"]
    : techsShot ? ["first_fix"] : [];
  const customLabel = shot === "custom-list" ? "" : customShot ? "Balcony drain" : "";
  const kindsOpen = shot === "kinds" || shot === "kinds-tablet" || shot === "combo" || customShot;
  const past: PastDraft = shot === "nologin"
    ? { techId: "fixture-abie-croy", date: "2026-11-03", arrive: "08:00", leave: "11:30", note: "", completed: false }
    : shot === "past" || shot === "combo"
    ? { techId: "t1", date: "2026-11-03", arrive: "08:00", leave: "11:30", note: "", completed: defaultCompleted([]) }
    : emptyPast();
  return (
    <Frame width={width} bar={bar}>
      <div className="mb-3 rounded-2xl bg-white p-3 shadow-sm">
        <h1 className="text-lg font-extrabold">Book a job</h1>
        <p className="text-xs text-muted-foreground">Create New Job — new work, past work, projects, and later corrections.</p>
        {shot === "nologin" && (
          <p className="mt-2 text-sm font-semibold" data-testid="nologin-techs">Fixture technicians: Abie Croy and George King. Same list for upcoming work, the job page, and the project house.</p>
        )}
        {project && <p className="mt-2 text-sm font-semibold">{titleDefault("Avec", "12", visitKinds, customLabel)}</p>}
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
          visitKinds={visitKinds}
          onVisitKinds={() => {}}
          customLabel={customLabel}
          kindsOpen={kindsOpen}
          canLogPast
          techs={shot === "nologin" ? HARNESS_NO_LOGIN_TECHS.map((t) => ({ id: t.id, name: t.name })) : TECHS}
          techsOpen={techsShot}
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
  const [visitKinds, setVisitKinds] = useState<VisitKind[]>([]);
  const [past, setPast] = useState<PastDraft>(emptyPast());
  const [visits, setVisits] = useState<VisitView[]>([]);
  const [saved, setSaved] = useState(false);
  const attached = where === "project" && houseId === "h12" ? houseAttachPlan({ id: "h12", house_no: "12" }, JOBS, "demo-client").job : null;
  const onVisit = (next: VisitKind[]) => {
    if (includesFirstFix(next) && !includesFirstFix(visitKinds)) setPast((p) => ({ ...p, completed: false }));
    setVisitKinds(next);
  };
  const save = () => {
    if (doing === "correct" && visits[0]) {
      const next = applyCorrection({
        id: visits[0].id, jobId: "job-12", techId: past.techId, techName: "Tech A", date: past.date, arrive: past.arrive, leave: past.leave, note: past.note, completed: past.completed, kinds: visitKinds,
      }, { note: past.note, date: past.date, kinds: visitKinds });
      setVisits([{ ...visits[0], note: next.note, date: next.date, kinds: next.kinds }]);
      return;
    }
    const row: VisitView = { id: "v1", techId: past.techId, tech: TECHS.find((t) => t.id === past.techId)?.name || "Tech A", date: past.date, arrive: past.arrive, leave: past.leave, note: past.note, kinds: visitKinds.length ? visitKinds : ["first_fix"] };
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
          visitKinds={visitKinds} onVisitKinds={onVisit}
          canLogPast techs={TECHS} past={past} onPast={setPast}
          visits={visits} correctId={null} onCorrect={() => {}}
          classic={doing === "upcoming" ? <DemoClassic /> : null}
        />
        <button type="button" className="mt-3 h-11 w-full rounded-xl bg-[#C2410C] font-semibold text-white" data-testid="harness-save" onClick={save}>Save visit</button>
      </div>
    </Frame>
  );
}
