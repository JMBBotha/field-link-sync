import "./index.css";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CheckCircle2, Phone, Navigation, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import JobPhotosCard from "@/components/jobs/JobPhotosCard";
import AddJobPhotosButton from "@/components/jobs/AddJobPhotosButton";
import JobVisitsCard from "@/components/jobs/JobVisits";
import EditJobDetailsSheet from "@/components/jobs/EditJobDetailsSheet";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { MarkCompletedDialog } from "@/components/jobs/JobAdminStatusDialogs";
import { jobActionBar, completedLabel } from "@/lib/jobActionBar";

const q = new URLSearchParams(location.search);
const state = q.get("s") || "scheduled";
const img = (c: string) => `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><rect width='200' height='200' fill='${c}'/></svg>`;
const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, enabled: false } } });
const empty = state === "empty";
qc.setQueryData(["dispatchable-techs", "co"], [{ id: "t1", name: "Demo Tech A" }, { id: "t2", name: "Demo Tech B" }]);
qc.setQueryData(["job-units-edit", "demo"], [{ id: "u1", unit_label: "Lounge", position: "indoor", brand: "DemoBrand", model: "DB-12K", serial_number: "SN-0001" }, { id: "u2", unit_label: "Lounge", position: "outdoor", brand: "DemoBrand", model: "DB-12K-O", serial_number: "SN-0002" }]);
qc.setQueryData(["job-photos-typed", "lead-demo"], empty ? { counts: { site: 0, before: 0, after: 0 }, before: [], after: [] } : {
  counts: { site: 0, before: 2, after: 1 },
  before: [{ id: "b1", url: img("%23a3c4e8"), photo_type: "before", caption: null }, { id: "b2", url: img("%237fa8d8"), photo_type: "before", caption: null }],
  after: [{ id: "a1", url: img("%2396d3a8"), photo_type: "after", caption: null }],
});
qc.setQueryData(["job-visits", "demo"], [{ id: "v1", date: "2026-11-03", start: "14:00", end: "17:00", tech: "t1", tech_name: "Demo Tech A", note: "Indoor units + piping" }, { id: "v2", date: "2026-11-04", start: "12:00", end: "14:00", tech: "t1", tech_name: "Demo Tech A", note: null }]);
const status = state === "completed" ? "completed" : state === "in_progress" ? "in_progress" : "scheduled";
const bar = jobActionBar(status, { admin: true, rep: true, tech: false }, state !== "rep");

function App() {
  return (
    <div className="min-h-screen bg-background pb-32">
      <div className="v8-bar-hdr p-4 text-white font-semibold" style={{ background: "var(--v8-bar)" }}>Job · Demo Customer</div>
      <div className="p-4 space-y-4">
        <Card className="rounded-2xl"><CardContent className="p-4 text-sm">Split install · 12 Example Road, Testville · {status}</CardContent></Card>
        <JobVisitsCard jobId="demo" />
        <Card className="rounded-2xl"><CardContent className="p-4"><JobPhotosCard leadId="lead-demo" addSlot={<AddJobPhotosButton leadId="lead-demo" />} /></CardContent></Card>
      </div>
      <div className="sticky-action-bar"><div className="sticky-action-bar-inner">
        <a className="sticky-action-icon"><Phone className="h-5 w-5 text-primary" /></a>
        <a className="sticky-action-icon"><Navigation className="h-5 w-5 text-primary" /></a>
        {bar.primary === "start" && <Button className="sticky-action-primary bg-primary text-white"><Play className="h-5 w-5" /> Start Job</Button>}
        {bar.primary === "complete" && <Button className="sticky-action-primary bg-green-600 text-white"><CheckCircle2 className="h-5 w-5" /> Complete Job</Button>}
        {bar.canMarkCompleted && <Button variant={bar.primary ? "outline" : "default"} className={bar.primary ? "min-h-[48px] px-2 text-sm shrink-0" : "sticky-action-primary bg-green-600 text-white"}><CheckCircle2 className="h-5 w-5" /> {bar.primary ? "Mark done" : "Mark completed"}</Button>}
        {bar.completedBadge && <div className="sticky-action-primary flex items-center justify-center gap-1.5 rounded-xl bg-green-50 text-green-800 border border-green-200 text-xs leading-tight font-semibold px-2"><CheckCircle2 className="h-5 w-5" /> {completedLabel("2026-10-30T09:15:00Z")}</div>}
        {bar.canReopen && <Button variant="outline" className="min-h-[48px] px-3">Reopen</Button>}
      </div></div>
      {(state === "edit" || state === "editrep") && <EditJobDetailsSheet open onOpenChange={() => {}} jobId="demo" companyId="co" scheduledFor="2026-11-03T07:30:00Z" techId="t1" perms={{ admin: state === "edit", rep: true }} />}
      {state === "dialog" && <MarkCompletedDialog jobId="demo" open onOpenChange={() => {}} suggestedAt="2026-10-30T07:30:00Z" />}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<BrowserRouter><QueryClientProvider client={qc}><AuthProvider><App /></AuthProvider></QueryClientProvider></BrowserRouter>);
