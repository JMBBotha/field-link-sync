import { useState, type ReactNode } from "react";
import { JobTypeChoice } from "@/components/jobs/JobTypeChoice";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { TimeInput24 } from "@/components/ui/time-input-24";
import { cn } from "@/lib/utils";
import {
  DOING_CHOICES, VISIT_KINDS, johannesburgToday, kindsLabel, toggleKind,
  type Doing, type VisitKind, type WhereMode,
} from "@/lib/bookJobPath";
import type { JobKind } from "@/lib/jobTypeChoice";

export type PastDraft = {
  techId: string;
  date: string;
  arrive: string;
  leave: string;
  note: string;
  completed: boolean;
};

export type VisitView = {
  id: string;
  techId?: string;
  tech: string;
  date: string;
  arrive: string;
  leave: string;
  note: string;
  kinds: VisitKind[];
  customLabel?: string | null;
};

export type Named = { id: string; name: string };
export type HouseOpt = { id: string; house_no: string };

const section = "space-y-2 rounded-xl border border-[#3D9BEB]/40 bg-white p-3";

function SectionTitle({ n, title }: { n: string; title: string }) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold text-[#0F2A44]">
      <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-[#3D9BEB] px-1.5 text-xs font-bold text-white">{n}</span>
      {title}
    </h3>
  );
}

export function WorkIntent({ value, onChange }: { value: Doing; onChange: (d: Doing) => void }) {
  return (
    <div className={section} data-testid="work-intent">
      <SectionTitle n="2" title="What are you doing?" />
      <div role="radiogroup" aria-label="What are you doing?" className="grid grid-cols-1 gap-2">
        {DOING_CHOICES.map((c) => {
          const on = value === c.id;
          return (
            <button key={c.id} type="button" role="radio" aria-checked={on} data-testid={`doing-${c.id}`} onClick={() => onChange(c.id)}
              className={cn("min-h-11 rounded-xl border-2 p-3 text-left", on ? "border-[#C2410C] bg-orange-50 ring-2 ring-orange-200" : "border-border bg-card")}>
              <div className="font-semibold">{c.title}</div>
              <div className="text-xs text-muted-foreground">{c.hint}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Dropdown that stays open so more than one kind can be ticked on the same visit. */
export function VisitKindMenu({ value, onChange, customLabel = "", onCustomLabel, open, onOpenChange }: {
  value: VisitKind[]; onChange: (next: VisitKind[]) => void; customLabel?: string; onCustomLabel?: (text: string) => void;
  open?: boolean; onOpenChange?: (open: boolean) => void;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const shown = open ?? localOpen;
  const setShown = (next: boolean) => { onOpenChange?.(next); if (open === undefined) setLocalOpen(next); };
  const summary = value.length ? kindsLabel(value, customLabel) : "Choose the work on this visit";
  return (
    <div className={section} data-testid="visit-kinds">
      <SectionTitle n="3" title="What kind of work?" />
      <p className="text-xs text-muted-foreground">Pick one or more. A visit can be a combination, for example First fix and Piping.</p>
      <button type="button" data-testid="visit-kind-menu" aria-expanded={shown} aria-haspopup="listbox" onClick={() => setShown(!shown)}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border-2 border-[#3D9BEB]/50 bg-white px-3 py-2 text-left">
        <span className={cn("font-semibold", !value.length && "text-muted-foreground")}>{summary}</span>
        <span aria-hidden className="text-[#3D9BEB]">{shown ? "▴" : "▾"}</span>
      </button>
      {shown && (
        <div role="listbox" aria-multiselectable="true" aria-label="What kind of work?" data-testid="visit-kind-list" className="rounded-xl border bg-white p-1 shadow-sm">
          {VISIT_KINDS.map((c) => {
            const on = value.includes(c.id);
            return (
              <label key={c.id} data-testid={`visit-kind-${c.id}`} className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2", on && "bg-orange-50")}>
                <input type="checkbox" checked={on} onChange={() => onChange(toggleKind(value, c.id))} />
                <span className="font-semibold">{c.title}</span>
              </label>
            );
          })}
        </div>
      )}
      {value.includes("custom") && (
        <label className="block text-sm">
          <span className="text-muted-foreground">Custom work <span className="text-destructive">*</span></span>
          <Input className="mt-1 h-11" data-testid="visit-custom" maxLength={80} placeholder="Name this work" value={customLabel}
            onChange={(e) => onCustomLabel?.(e.target.value)} />
        </label>
      )}
    </div>
  );
}

export function PastVisitFields({ techs, value, onChange, maxDate }: {
  techs: Named[]; value: PastDraft; onChange: (p: PastDraft) => void; maxDate?: string;
}) {
  const max = maxDate || johannesburgToday();
  const set = (patch: Partial<PastDraft>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-3" data-testid="past-visit-fields">
      <label className="block text-sm">
        <span className="text-muted-foreground">Technician</span>
        <select className="mt-1 h-11 w-full rounded-lg border bg-background px-3" data-testid="past-tech" value={value.techId} onChange={(e) => set({ techId: e.target.value })}>
          <option value="">Choose technician…</option>
          {techs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <label className="block text-sm">
        <span className="text-muted-foreground">Date it happened</span>
        <Input type="date" className="mt-1 h-11" max={max} data-testid="past-date" value={value.date} onChange={(e) => set({ date: e.target.value })} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm" data-testid="past-arrive"><span className="mb-1 block text-muted-foreground">Arrived</span>
          <TimeInput24 aria-label="Arrived" value={value.arrive} onChange={(e) => set({ arrive: e.target.value })} /></label>
        <label className="text-sm" data-testid="past-leave"><span className="mb-1 block text-muted-foreground">Left</span>
          <TimeInput24 aria-label="Left" value={value.leave} onChange={(e) => set({ leave: e.target.value })} /></label>
      </div>
      <label className="flex items-center justify-between gap-3 rounded-xl border p-3 text-sm" data-testid="past-finished">
        <span>Whole job finished on this visit</span>
        <Switch checked={value.completed} onCheckedChange={(v) => set({ completed: v })} aria-label="Whole job finished on this visit" />
      </label>
      <Input className="h-11" data-testid="past-note" placeholder="Optional note (e.g. First fix)" value={value.note} onChange={(e) => set({ note: e.target.value })} />
    </div>
  );
}

export function VisitList({ visits, correctId, onCorrect }: { visits: VisitView[]; correctId?: string | null; onCorrect?: (id: string) => void }) {
  if (!visits.length) return <p className="text-xs text-muted-foreground" data-testid="visit-list-empty">No visit on this job yet.</p>;
  return (
    <div className="space-y-1.5" data-testid="visit-list">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Visits</p>
      {visits.map((v) => {
        const on = correctId === v.id;
        const kindLabel = v.kinds?.length ? kindsLabel(v.kinds, v.customLabel) : "Visit";
        const extra = v.note && v.note.trim().toLowerCase() !== kindLabel.toLowerCase() ? ` · ${v.note}` : "";
        const body = (
          <>
            <p className="font-medium">{v.tech || "Tech"} · {v.date} · {String(v.arrive || "").slice(0, 5)}{v.leave ? `–${String(v.leave).slice(0, 5)}` : ""}</p>
            <p className="text-xs text-muted-foreground">{kindLabel}{extra}</p>
          </>
        );
        return onCorrect ? (
          <button key={v.id} type="button" data-testid="saved-visit" aria-pressed={on} onClick={() => onCorrect(v.id)}
            className={cn("w-full rounded-xl border p-2.5 text-left text-sm", on ? "border-[#C2410C] bg-orange-50" : "border-border")}>{body}</button>
        ) : (
          <div key={v.id} data-testid="saved-visit" className="rounded-xl border p-2.5 text-sm">{body}</div>
        );
      })}
    </div>
  );
}

export function HouseFirstFitLine({ done, inStep }: { done: boolean; inStep: boolean }) {
  return (
    <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950" data-testid="house-first-fit">
      First fit {done ? "done" : "not yet"}{inStep ? " · in step with the visit" : ""}
    </p>
  );
}

export function BookJobForm(props: {
  where: WhereMode;
  onWhere: (w: WhereMode) => void;
  doing: Doing;
  onDoing: (d: Doing) => void;
  projects: Named[];
  projectId: string;
  onProject: (id: string) => void;
  houses: HouseOpt[];
  houseId: string;
  onHouse: (id: string) => void;
  clientLabel?: string | null;
  projectHref?: string | null;
  attachedTitle?: string | null;
  cards: "new_sale" | "visit";
  jobKind: JobKind | null;
  onJobKind: (k: JobKind) => void;
  visitKinds: VisitKind[];
  onVisitKinds: (next: VisitKind[]) => void;
  customLabel?: string;
  onCustomLabel?: (text: string) => void;
  kindsOpen?: boolean;
  onKindsOpen?: (open: boolean) => void;
  canLogPast: boolean;
  techs: Named[];
  past: PastDraft;
  onPast: (p: PastDraft) => void;
  visits: VisitView[];
  correctId: string | null;
  onCorrect: (id: string) => void;
  classic?: ReactNode;
  showHouseFit?: boolean;
  firstFitDone?: boolean;
  firstFitInStep?: boolean;
}) {
  const p = props;
  const logging = p.doing === "past" || p.doing === "correct";
  return (
    <div className="space-y-4" data-testid="book-a-job">
      <section className={section}>
        <SectionTitle n="1" title="Where is the work?" />
        <p className="text-xs text-muted-foreground">Single job is the usual path. Turn Project / estate on to pick a house without leaving this screen.</p>
        <label className="flex items-center justify-between gap-3 rounded-xl border-2 border-[#3D9BEB]/50 p-3" data-testid="project-estate">
          <span>
            <span className="block font-semibold">Project / estate</span>
            <span className="text-xs text-muted-foreground">{p.where === "project" ? "On — pick the project, then the house." : "Off — single job, pick the client as today."}</span>
          </span>
          <Switch checked={p.where === "project"} onCheckedChange={(v) => p.onWhere(v ? "project" : "single")} aria-label="Project or estate" />
        </label>
        {p.where === "project" && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-muted-foreground">Project</span>
              <select className="mt-1 h-11 w-full rounded-lg border bg-background px-3" data-testid="book-project" value={p.projectId} onChange={(e) => p.onProject(e.target.value)}>
                <option value="">Choose project…</option>
                {p.projects.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-muted-foreground">House</span>
              <select className="mt-1 h-11 w-full rounded-lg border bg-background px-3" data-testid="book-house" value={p.houseId} onChange={(e) => p.onHouse(e.target.value)} disabled={!p.projectId}>
                <option value="">Choose house…</option>
                {p.houses.map((h) => <option key={h.id} value={h.id}>House {h.house_no}</option>)}
              </select>
            </label>
          </div>
        )}
        {p.clientLabel && <p className="text-sm" data-testid="house-client">Client: {p.clientLabel}</p>}
        {p.attachedTitle && (
          <div className="rounded-xl border border-[#3D9BEB] bg-sky-50 p-3 text-sm" data-testid="attached-job">
            <p className="font-semibold">Attached to this house's installation job</p>
            <p>{p.attachedTitle}</p>
            <p className="text-xs text-muted-foreground">No new sale and no second job.</p>
          </div>
        )}
        {p.projectHref && (
          <a href={p.projectHref} target="_blank" rel="noreferrer" data-testid="open-house-link" className="inline-block text-xs font-medium text-[#3D9BEB] underline">
            Open this house on Projects
          </a>
        )}
      </section>

      <WorkIntent value={p.doing} onChange={p.onDoing} />

      {p.cards === "new_sale" && <JobTypeChoice value={p.jobKind} onChange={p.onJobKind} label="What does the client need?" />}
      {p.cards === "visit" && (
        <VisitKindMenu value={p.visitKinds} onChange={p.onVisitKinds} customLabel={p.customLabel} onCustomLabel={p.onCustomLabel} open={p.kindsOpen} onOpenChange={p.onKindsOpen} />
      )}

      {p.showHouseFit && <HouseFirstFitLine done={!!p.firstFitDone} inStep={!!p.firstFitInStep} />}

      {logging && !p.canLogPast && (
        <p className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" data-testid="past-admin-only">
          Only an admin can log or correct a past visit.
        </p>
      )}
      {p.doing === "correct" && <VisitList visits={p.visits} correctId={p.correctId} onCorrect={p.onCorrect} />}
      {logging && p.canLogPast && <PastVisitFields techs={p.techs} value={p.past} onChange={p.onPast} />}
      {p.doing === "upcoming" && p.classic}
      {p.doing !== "correct" && p.visits.length > 0 && <VisitList visits={p.visits} />}
    </div>
  );
}
