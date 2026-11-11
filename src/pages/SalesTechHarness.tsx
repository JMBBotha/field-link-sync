/** Demo shots for technicians a salesperson can book. Fixture names only — not live staff. */
import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { PastVisitFields, type PastDraft } from "@/components/jobs/BookJobForm";
import { SalesTechChecklist } from "@/components/team/SalesTechChecklist";
import { NO_TECHS_ASSIGNED } from "@/lib/salesTechAccess";
import { johannesburgToday } from "@/lib/bookJobPath";

const TECHS = [
  { id: "tech-a", name: "Tech A" },
  { id: "tech-b", name: "Tech B", noLogin: true },
];

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#eef6fb] text-[#0F2A44]" data-testid="sales-tech-harness">
      <header className="flex items-center justify-between px-3 text-white" style={{ height: 48, background: "#3D9BEB" }}>
        <b>{title}</b>
        <small className="text-[11px] font-semibold">Demo — harness, not live staff</small>
      </header>
      <div className="mx-auto max-w-[420px] px-3 py-3">{children}</div>
    </div>
  );
}

function TeamShot() {
  const [assigned, setAssigned] = useState<string[]>(["tech-a"]);
  return (
    <Frame title="Team">
      <button type="button" className="mb-3 rounded-md px-3 py-2 text-sm font-semibold text-white" style={{ background: "#C2410C" }}>
        Invite Member
      </button>
      <div className="rounded-2xl bg-white shadow-sm">
        <div className="flex items-center justify-between px-4 py-3">
          <div>
            <p className="font-medium">Demo Sales</p>
            <p className="text-xs text-muted-foreground">Salesperson</p>
          </div>
          <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs font-medium text-blue-50">Salesperson</span>
        </div>
        <div className="border-t border-border/30 bg-muted/20 p-4">
          <SalesTechChecklist
            techs={TECHS}
            assignedIds={assigned}
            onToggle={(id, on) => setAssigned((cur) => on ? [...cur, id] : cur.filter((x) => x !== id))}
          />
        </div>
      </div>
    </Frame>
  );
}

function BookShot() {
  const [past, setPast] = useState<PastDraft>({
    techId: "tech-a", date: johannesburgToday(), arrive: "08:00", leave: "11:30", note: "", completed: false,
  });
  return (
    <Frame title="Book a job">
      <div className="mb-3 rounded-2xl bg-white p-3 shadow-sm">
        <h1 className="text-lg font-extrabold">Book a job</h1>
        <p className="text-xs text-muted-foreground">Sales view. Only the technicians an admin assigned.</p>
      </div>
      <div className="rounded-2xl bg-white p-3 shadow-sm">
        <PastVisitFields
          techs={[{ id: "tech-a", name: "Tech A" }]}
          value={past}
          onChange={setPast}
          techsOpen
        />
      </div>
    </Frame>
  );
}

function EmptyShot() {
  const [past, setPast] = useState<PastDraft>({
    techId: "", date: johannesburgToday(), arrive: "08:00", leave: "", note: "", completed: false,
  });
  return (
    <Frame title="Book a job">
      <div className="mb-3 rounded-2xl bg-white p-3 shadow-sm">
        <h1 className="text-lg font-extrabold">Book a job</h1>
        <p className="text-xs text-muted-foreground">Sales view. Nobody assigned yet.</p>
      </div>
      <div className="rounded-2xl bg-white p-3 shadow-sm">
        <PastVisitFields techs={[]} value={past} onChange={setPast} emptyMessage={NO_TECHS_ASSIGNED} />
      </div>
    </Frame>
  );
}

export default function SalesTechHarness() {
  const [params] = useSearchParams();
  const shot = params.get("shot") || "team";
  if (shot === "book") return <BookShot />;
  if (shot === "empty") return <EmptyShot />;
  return <TeamShot />;
}
