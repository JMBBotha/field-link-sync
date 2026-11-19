/** Demo shots for Assign rep on a sales lead. Harness rows only — not a live lead. */
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import LeadPageC from "@/components/leads/LeadPageC";
import AssignSalesRepDialog from "@/components/jobs/AssignSalesRepDialog";

const COMPANY = "361bf031-9cdb-4d7f-9bde-9eb95fa4725e";
const ALMARI = "f7503c66-0000-4000-8000-00000000a1a1";
const REPS = [
  { id: ALMARI, name: "Almari Cloete" },
  { id: "420c7731-e8a4-4355-80ca-51c684b42a2c", name: "Johan Sales" },
];

const baseLead = {
  id: "96b94474-cc52-46ad-a904-e4ddb7f7f499",
  customer_name: "Munirah Botha",
  customer_phone: "082 555 0148",
  email: "munirah.botha@example.com",
  customer_address: "18 Demo Road, Cape Town",
  service_type: "New Quote",
  primary_intent: "sales",
  status: "pending",
  priority: "normal",
  company_id: COMPANY,
  created_at: "2026-11-18T12:56:00.000Z",
  notes: "Website request for a lounge air conditioner.",
};

function Page() {
  const [params] = useSearchParams();
  const shot = params.get("shot") || "assign";
  const assigned = shot === "assigned";
  const [picker, setPicker] = useState(shot === "picker");
  const [repName, setRepName] = useState(assigned ? "Almari Cloete" : "");
  const [repId, setRepId] = useState(assigned ? ALMARI : "");
  const lead = {
    ...baseLead,
    assigned_agent_id: repId || null,
    assigned_to_name: repName || null,
  };
  const label = repId ? "Reassign rep" : "Assign rep";
  const repAction = {
    label,
    testId: repId ? "reassign-rep" : "assign-rep",
    phone: true,
    className: "bg-[#C2410C] text-white hover:bg-[#9A3412]",
    onClick: () => setPicker(true),
  };
  const quote = { label: "Create / Open Quote", onClick: () => {} };
  const next = repId
    ? { title: "Prepare and send the quote", primary: quote, secondary: [repAction] }
    : { title: "Book the free quote visit", primary: { label: "Book free quote visit", onClick: () => {}, testId: "lead-c-assign" }, secondary: [repAction, quote] };

  return (
      <div className="min-h-screen bg-background text-foreground" data-testid="assign-rep-harness">
      <style>{`[data-testid="lead-c-close"]:not(:has(*)){display:none}`}</style>
      <header className="flex items-center justify-between px-3 text-white" style={{ height: 48, background: "#3D9BEB" }}>
        <b>Dispatch</b>
        <small className="text-[11px] font-semibold">Demo — harness, not a live lead</small>
      </header>
      <div className="mx-auto max-w-3xl px-3 py-3">
        <LeadPageC lead={lead} next={next} editFields={["customer_name", "customer_phone", "service_type", "assigned_agent_id"]} canEdit={false} stickyBar>
          <p className="text-xs text-muted-foreground">Sample sales lead for the assign-rep screenshots. Nothing here is saved.</p>
        </LeadPageC>
      </div>
      <AssignSalesRepDialog
        lead={picker ? lead : null}
        reps={REPS}
        defaultRepId={shot === "picker" ? ALMARI : ""}
        onClose={() => setPicker(false)}
        onAssigned={(rep) => { setRepId(rep.id); setRepName(rep.name); }}
      />
    </div>
  );
}

const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

export default function AssignRepHarness() {
  const [params] = useSearchParams();
  if (params.get("theme") === "dark") document.documentElement.classList.add("dark");
  else document.documentElement.classList.remove("dark");
  return (
    <QueryClientProvider client={qc}>
      <Page />
    </QueryClientProvider>
  );
}
