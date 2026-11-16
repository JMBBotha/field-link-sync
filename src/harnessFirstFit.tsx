/** Screenshot harness. Fixture houses only, not Massair CT. */
import "./index.css";
import "./components/v8/v8.css";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import FirstFitPanel, { type FirstFitView } from "@/components/projects/FirstFitPanel";
import { HouseCard } from "@/components/projects/ProjectView";
import InvoiceCoversLine from "@/components/invoicing/InvoiceCoversLine";
import type { ProjectHouse } from "@/lib/projectTracker";
import type { HouseFitBadge } from "@/lib/firstFitApi";

const capture: FirstFitView = {
  houseNo: "32",
  projectName: "AVEC",
  live: false,
  points: [{ id: "p1", area: "Lounge", unitSize: "12K", pipeM: 6.5 }],
  units: [{ area: "Lounge", unitSize: "12K" }, { area: "Kitchen", unitSize: "18K" }],
  pipeM: 6.5,
  deposit: null,
  balance: null,
  quote: null,
  showMoney: false,
  canEditList: false,
};

const live: FirstFitView = {
  houseNo: "32",
  projectName: "AVEC",
  live: true,
  completeAt: "2026-09-01T08:00:00+02:00",
  completeBy: "Thabo",
  points: [
    { id: "p1", area: "Lounge", unitSize: "12K", pipeM: 6.5 },
    { id: "p2", area: "Kitchen", unitSize: "18K", pipeM: 4 },
  ],
  units: [{ area: "Lounge", unitSize: "12K" }, { area: "Kitchen", unitSize: "18K" }],
  pipeM: 10.5,
  deposit: { on: "2026-11-15", state: "overdue", estimated: false, number: "INV-DEMO-1", id: "inv-1", amount: 4370 },
  balance: { on: "2027-01-15", state: "estimated", estimated: true, amount: null },
  quote: { id: "q1", number: "Q-DEMO-0142", total: 8740, status: "draft", flag: null },
  showMoney: true,
  canEditList: true,
};

const covered: FirstFitView = {
  houseNo: "17528",
  projectName: "Stellenbosch Village",
  live: true,
  completeAt: "2026-09-01T08:00:00+02:00",
  completeBy: "Thabo",
  points: [{ id: "p1", area: "Lounge", unitSize: "12K", pipeM: 6.5 }],
  units: [{ area: "Lounge", unitSize: "12K" }],
  pipeM: 6.5,
  deposit: null,
  balance: null,
  quote: { id: "q1", number: "Q-DEMO-0142", total: 8740, status: "draft", flag: null },
  showMoney: true,
  canEditList: false,
  alreadyInvoicedOn: "0010021",
};

const skipped: FirstFitView = {
  ...covered,
  houseNo: "17529",
};

const none: Pick<HouseFitBadge, "alreadyInvoicedOn" | "unitsInvoiceNeeded" | "labourInvoice"> = {
  alreadyInvoicedOn: null, unitsInvoiceNeeded: false, labourInvoice: null,
};

const house = (no: string, done: boolean): ProjectHouse => ({
  id: no, house_no: no, phase_id: null, po_number: "ADV3695", make: "Samsung", unit_sizes: null,
  units_ordered: 0, units_received: 0, ready_for_aircon: false, ready_for_aircon_at: null,
  status_override: null, notes: null,
  steps: ["first_fit", "piping", "units", "commissioning"].map((k, i) => ({
    id: `${no}-${k}`, step_key: k, label: k, rate: 0, sort_order: i, done: done && k === "first_fit", paid: false,
  })),
});

function Screen({ dark }: { dark: boolean }) {
  const shot = new URLSearchParams(location.search).get("shot") || "all";
  const show = (name: string) => shot === "all" || shot === name;
  return (
    <div className={dark ? "dark bg-background text-foreground" : "bg-[#EEF3F8] text-foreground"}>
      <header className="v8-bar-hdr flex h-14 items-center px-4 text-lg font-bold text-white" style={{ background: "#3D9BEB" }}>
        {shot === "covers" ? "Invoices" : shot === "covered" ? "ERF 17528 · Stellenbosch Village" : shot === "skip" ? "ERF 17529 · draft skipped" : "House 32 · AVEC"}
      </header>
      <div className="mx-auto max-w-md space-y-4 p-3">
        {show("capture") && <FirstFitPanel view={capture} onSnap={() => {}} onComplete={() => {}} />}
        {show("live") && <FirstFitPanel view={live} onUndo={() => {}} onSaveUnits={() => {}} />}
        {show("covered") && <FirstFitPanel view={covered} onUndo={() => {}} />}
        {show("skip") && <FirstFitPanel view={skipped} onUndo={() => {}} />}
      </div>
      {show("covers") && (
        <div className="v8-scope mx-auto max-w-md space-y-3 p-3">
          <div className="v8-navy">
            <h1 className="text-lg font-bold">Invoice 0010021</h1>
          </div>
          <InvoiceCoversLine houses={[
            { house_no: "17529", note: "Kept whole. Full system for this ERF." },
            { house_no: "17528", note: "Kept whole. Full system for this ERF." },
          ]} />
          <div className="v8-navy">
            <h1 className="text-lg font-bold">Invoice 0010023</h1>
          </div>
          <InvoiceCoversLine houses={[
            { house_no: "17536", note: "Labour extraction, kept whole. Units to be billed later." },
            { house_no: "17533", note: "Labour extraction, kept whole. Units to be billed later." },
            { house_no: "17534", note: "Labour extraction, kept whole. Units to be billed later." },
            { house_no: "17535", note: "Labour extraction, kept whole. Units to be billed later." },
          ]} />
        </div>
      )}
      {show("covered") && (
        <div className="grid grid-cols-2 gap-2 p-3" data-testid="house-grid">
          <HouseCard h={house("17528", true)} status="in_progress" onOpen={() => {}} fit={{
            houseId: "17528", live: true, points: 1, areas: 1, pipeM: 6.5,
            depositOn: null, depositState: null, balanceOn: null, balanceState: null, balanceEstimated: false,
            alreadyInvoicedOn: "0010021", unitsInvoiceNeeded: false, labourInvoice: null,
          }} />
          <HouseCard h={house("17533", true)} status="in_progress" onOpen={() => {}} fit={{
            houseId: "17533", live: true, points: 1, areas: 1, pipeM: 4,
            depositOn: null, depositState: null, balanceOn: null, balanceState: null, balanceEstimated: false,
            alreadyInvoicedOn: null, unitsInvoiceNeeded: true, labourInvoice: "0010023",
          }} />
        </div>
      )}
      {show("cards") && (
        <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3" data-testid="house-grid">
          <HouseCard h={house("31", true)} status="in_progress" onOpen={() => {}} />
          <HouseCard h={house("32", true)} status="in_progress" onOpen={() => {}} fit={{
            houseId: "32", live: true, points: 2, areas: 2, pipeM: 10.5,
            depositOn: "2026-11-15", depositState: "overdue", balanceOn: "2027-01-15", balanceState: "estimated", balanceEstimated: true,
            ...none,
          }} />
          <HouseCard h={house("33", false)} status="not_started" onOpen={() => {}} fit={{
            houseId: "33", live: true, points: 1, areas: 1, pipeM: 4,
            depositOn: "2026-11-20", depositState: "due_soon", balanceOn: "2027-01-19", balanceState: "estimated", balanceEstimated: true,
            ...none,
          }} />
          <HouseCard h={house("34", false)} status="not_started" onOpen={() => {}} fit={{
            houseId: "34", live: true, points: 1, areas: 1, pipeM: 5,
            depositOn: "2026-11-16", depositState: "due_today", balanceOn: "2026-12-01", balanceState: "upcoming", balanceEstimated: false,
            ...none,
          }} />
        </div>
      )}
    </div>
  );
}

const dark = new URLSearchParams(location.search).get("theme") === "dark";
if (dark) document.documentElement.classList.add("dark");
createRoot(document.getElementById("root")!).render(
  <MemoryRouter><Screen dark={dark} /></MemoryRouter>,
);
