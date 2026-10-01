import { useState } from "react";
import { useSearchParams, useNavigate, useLocation, Navigate } from "react-router-dom";
import { useRole } from "@/hooks/useRole";
import { useSalesRep } from "@/hooks/useSalesRep";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LayoutGrid, Columns3, Plus, CalendarDays } from "lucide-react";
import PipelineBoard, { usePipelineData, pipelineOpenValue } from "@/components/jobs/PipelineBoard";
import DispatchCards from "@/components/jobs/DispatchCards";
import AttentionStrip from "@/components/jobs/AttentionStrip";
import CreateJobDialog from "@/components/jobs/CreateJobDialog";
import AdminJobsDispatchPage from "@/pages/admin/AdminJobsDispatchPage";
import { fmtRandShort } from "@/lib/quotePipeline";

type Tab = "pipeline" | "dispatch";
type View = "cards" | "stages";
const store = (k: string, v?: string) => {
  try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch { /* private mode */ }
  return null;
};

/** Old /admin/jobs/dispatch links (drilldowns, bookmarks) land on Dispatch · Stages with their filters kept. */
export function JobsDispatchRedirect() {
  const { search } = useLocation();
  const p = new URLSearchParams(search);
  p.set("tab", "dispatch");
  if (!p.get("view")) p.set("view", "stages");
  return <Navigate to={`/admin/jobs?${p.toString()}`} replace />;
}

/**
 * Jobs hub: [Pipeline · coming | Dispatch · live] switch + [Cards | Stages] toggle on both tabs.
 * Choice is remembered per user per tab (localStorage fls.jobs.*) and mirrored in the URL (?tab=&view=).
 * Role defaults on first visit: admin → Pipeline·Stages, sales rep → Pipeline·Cards, dispatcher → Dispatch·Cards.
 */
export default function AdminJobsHubPage() {
  const [sp, setSp] = useSearchParams();
  const navigate = useNavigate();
  const { isAdmin, isDispatcher, loading } = useRole();
  const { isSalesRep, loading: repLoading } = useSalesRep();
  const pipe = usePipelineData();
  const [showCreate, setShowCreate] = useState(false);
  if (loading || repLoading) return null;

  const defTab: Tab = isSalesRep || isAdmin || !isDispatcher ? "pipeline" : "dispatch";
  const defViewFor = (t: Tab): View => (t === "pipeline" ? (isSalesRep ? "cards" : "stages") : "cards");
  const urlTab = sp.get("tab");
  const tab: Tab = urlTab === "pipeline" || urlTab === "dispatch" ? urlTab : ((store("fls.jobs.tab") as Tab) || defTab);
  const urlView = sp.get("view");
  const view: View = urlView === "cards" || urlView === "stages" ? urlView : ((store(`fls.jobs.view.${tab}`) as View) || defViewFor(tab));

  const go = (t: Tab, v?: View) => {
    store("fls.jobs.tab", t);
    const nextView = v || ((store(`fls.jobs.view.${t}`) as View) || defViewFor(t));
    store(`fls.jobs.view.${t}`, nextView);
    setSp((p) => {
      const n = t === tab ? new URLSearchParams(p) : new URLSearchParams();
      n.set("tab", t); n.set("view", nextView); return n;
    }, { replace: true });
  };

  const open = pipelineOpenValue(pipe.data);
  return (
    <div className="space-y-3 p-3 sm:p-4 md:p-6" data-jobs-hub>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-2xl font-bold tracking-tight">Jobs</h1>
        <div className="inline-flex rounded-lg border bg-muted/60 p-1" role="tablist">
          {(["pipeline", "dispatch"] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => go(t)}
              className={cn("rounded-md px-3 py-1.5 text-sm font-semibold", tab === t ? "bg-background shadow" : "text-muted-foreground")}>
              {t === "pipeline" ? <>Pipeline · coming <span className="text-xs font-normal text-muted-foreground">{fmtRandShort(open)}</span></> : <>Dispatch · live</>}
            </button>
          ))}
        </div>
        <div className="inline-flex rounded-lg border p-1">
          {(["cards", "stages"] as View[]).map((v) => (
            <button key={v} onClick={() => go(tab, v)} aria-pressed={view === v}
              className={cn("inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold", view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
              {v === "cards" ? <LayoutGrid className="h-3.5 w-3.5" /> : <Columns3 className="h-3.5 w-3.5" />}{v === "cards" ? "Cards" : "Stages"}
            </button>
          ))}
        </div>
        {tab === "pipeline" ? (
          <Button size="sm" className="ml-auto gap-1" onClick={() => navigate("/admin/quote-builder")}><Plus className="h-4 w-4" /> New quote</Button>
        ) : (
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" className="gap-1" onClick={() => navigate("/admin/dispatch")}><CalendarDays className="h-4 w-4" /> Calendar</Button>
            {view === "cards" && <Button size="sm" className="gap-1" onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> New job</Button>}
          </div>
        )}
      </div>
      {tab === "pipeline" ? <PipelineBoard view={view} /> : (
        <>
          <AttentionStrip />
          {view === "cards" ? <DispatchCards /> : <div className="-m-3 sm:-m-4 md:-m-6"><AdminJobsDispatchPage embedded /></div>}
        </>
      )}
      <CreateJobDialog open={showCreate} onOpenChange={setShowCreate} />
    </div>
  );
}
