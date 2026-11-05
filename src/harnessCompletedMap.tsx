/** Fixture only. Sample rows, not live company data. */
import "./index.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider } from "@/contexts/AuthContext";
import CompletedLeadsPanel from "@/components/CompletedLeadsPanel";
import { completedMapCards, withCompletedJobCount, type CompletedMapJob } from "@/lib/completedMapJobs";

const CT = "company-ct";
const jobs: CompletedMapJob[] = [
  {
    id: "af49ca54-job", company_id: CT, status: "scheduled", completed_at: null, job_type: "installation",
    lead: { id: "0a0c1c34-lead", customer_name: "Hennie Matthee", service_type: "installation", company_id: CT, customer_address: "19 Amandel Close, Bellville", latitude: -33.9, longitude: 18.6 },
    assignee_ids: ["09a7f5af-innocent"],
  },
  {
    id: "marina-job", company_id: CT, status: "completed", completed_at: "2026-11-01T08:00:00+02:00",
    lead: { id: "marina-lead", customer_name: "Marina", service_type: "installation", company_id: CT, customer_phone: "021 000 0000", customer_address: "1 Marina Road, Cape Town", latitude: -33.92, longitude: 18.42 },
    completion: { status: "completed", completed_at: "2026-11-01T08:30:00+02:00", technician_id: "tech-1", technician_name: "Completed Tech" },
  },
];
const cards = completedMapCards({ jobs, companyId: CT });
const chip = withCompletedJobCount({ pending: 2, accepted: 0, in_progress: 0, completed: 6, cancelled: 4 }, cards.length);

function App() {
  const [opened, setOpened] = useState("Click a name to open the job. Locate stays on the map.");
  return (
    <div className="min-h-screen bg-[#F3F6FA] p-3">
      <p className="mb-2 rounded-md bg-amber-100 px-3 py-1 text-center text-[12px] font-semibold text-amber-900">Fixture — sample rows, not live company data. Hennie is a converted lead with a scheduled job and is not listed.</p>
      <p data-opened className="mb-2 text-center text-[13px] font-semibold text-[#0F2A44]">{opened}</p>
      <div className="mb-3 inline-flex items-center gap-1 rounded-full border bg-white px-2 py-1 text-xs font-semibold">
        Completed <span className="tabular-nums">{chip.completed}</span>
      </div>
      <div className="h-[640px] max-w-md overflow-hidden rounded-2xl border bg-white shadow-sm">
        <CompletedLeadsPanel
          cards={cards}
          isVisible={false}
          onOpenJob={(id) => setOpened(`Opened /admin/jobs/${id}`)}
          onLeadClick={(lat, lng, leadId) => setOpened(`Locate lead ${leadId} at ${lat}, ${lng}`)}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<AuthProvider><App /></AuthProvider>);
