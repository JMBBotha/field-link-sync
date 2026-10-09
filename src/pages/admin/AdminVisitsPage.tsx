import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, FileText, MapPin, Navigation, Phone, PlusCircle } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import PullToRefresh from "@/components/PullToRefresh";
import AcceptLeadDialog from "@/components/leads/AcceptLeadDialog";
import AcceptedWorkSection from "@/components/quoting/AcceptedWorkSection";
import SitePhotosSection from "@/components/photos/SitePhotosSection";
import { useMyVisits } from "@/hooks/useMyVisits";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { offerText } from "@/lib/leadOffers";
import { filterVisits, mapsLink, suburbOf, visitTab, type VisitRow, type VisitTab } from "@/lib/visits";

const TABS: { key: VisitTab; label: string }[] = [
  { key: "available", label: "Available" },
  { key: "upcoming", label: "Upcoming" },
  { key: "handover", label: "To hand over" },
  { key: "done", label: "Done" },
];

const money = (n: number | null) =>
  n == null ? "" : `R ${Number(n).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const when = (r: VisitRow) => {
  if (!r.scheduled_date) return "Not scheduled";
  const d = new Date(`${r.scheduled_date}T00:00:00`);
  const day = d.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });
  return r.scheduled_time ? `${day} · ${r.scheduled_time.slice(0, 5)}` : day;
};

function QuoteChip({ r }: { r: VisitRow }) {
  if (!r.quote_id) return null;
  return (
    <Badge variant="outline" className="text-[11px] gap-1" data-testid="visit-quote-chip">
      <FileText className="h-3 w-3" />
      {r.quote_number ?? "Quote"} · {r.quote_status}
      {r.quote_total != null && <span className="font-semibold">· {money(r.quote_total)}</span>}
    </Badge>
  );
}

/** /admin/visits: mobile-first list of a salesperson's visits (P1). */
export const AdminVisitsPage = () => {
  const { data, isLoading, error, refetch } = useMyVisits(60);
  const [tab, setTab] = useState<VisitTab>("upcoming");
  const counts = useMemo(() => {
    const c: Record<VisitTab, number> = { available: 0, upcoming: 0, handover: 0, done: 0 };
    (data ?? []).forEach((r) => { const t = visitTab(r); if (t) c[t]++; });
    return c;
  }, [data]);
  const rows = filterVisits(data, tab);
  return (
    <div className="p-3 sm:p-6 space-y-3 max-w-3xl" data-testid="visits-page">
      <div className="flex items-center gap-2">
        <CalendarDays className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold">My visits</h1>
      </div>
      <Tabs value={tab} onValueChange={(v) => setTab(v as VisitTab)}>
        <TabsList className="grid grid-cols-4 w-full h-auto">
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key} className="min-h-[44px] text-xs px-1 flex-col leading-tight" data-testid={`visits-tab-${t.key}`}>
              <span>{t.label}</span>
              <span className="text-[10px] opacity-70">{counts[t.key]}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <PullToRefresh onRefresh={async () => { await refetch(); }}>
        <div className="space-y-2" data-testid="visits-list">
          {isLoading && <p className="text-sm text-muted-foreground p-4">Loading…</p>}
          {error && <p className="text-sm text-destructive p-4">Couldn't load visits: {(error as Error).message}</p>}
          {!isLoading && !error && rows.length === 0 && (
            <p className="text-sm text-muted-foreground p-4">Nothing here right now.</p>
          )}
          {rows.map((r) => (
            <Link key={r.lead_id} to={`/admin/visits/${r.lead_id}`} data-testid="visit-card"
              className="block rounded-xl border border-border/60 bg-card p-3 min-h-[44px] active:bg-muted/50">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{r.customer_name || "Client"}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                    <MapPin className="h-3 w-3 shrink-0" />{suburbOf(r.address) || "No address"}
                  </div>
                </div>
                <div className="text-xs text-right shrink-0">{when(r)}</div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1">
                <QuoteChip r={r} />
                {!r.is_mine && offerText(r.offer_km, r.offer_label) && (
                  <span className="text-xs text-muted-foreground" data-testid="visit-offer">{offerText(r.offer_km, r.offer_label)}</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      </PullToRefresh>
    </div>
  );
};

/** /admin/visits/:leadId: visit detail for the rep (P1) with site photos (P2). */
export const AdminVisitDetailPage = () => {
  const { leadId } = useParams<{ leadId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const { toast } = useToast();
  const { data, isLoading } = useMyVisits(60);
  const [accepting, setAccepting] = useState(false);
  const r = (data ?? []).find((x) => x.lead_id === leadId);
  if (isLoading) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  if (!r) return (
    <div className="p-4 space-y-3">
      <p className="text-sm">This visit isn't in your list.</p>
      <Button variant="outline" onClick={() => navigate("/admin/visits")}>Back to My visits</Button>
    </div>
  );
  const tab = visitTab(r);
  const nav = mapsLink(r);
  const createQuote = () => {
    if (!r.customer_id) {
      toast({ title: "No client linked to this lead yet", description: "Open it from Leads to link a client first.", variant: "destructive" });
      return;
    }
    const p = new URLSearchParams({ leadId: r.lead_id, customerId: r.customer_id, quoteName: `Quote - ${r.customer_name ?? ""}` });
    navigate(`/admin/quote-builder?${p.toString()}`);
  };
  return (
    <div className="p-3 sm:p-6 space-y-3 max-w-3xl" data-testid="visit-detail">
      <Button variant="ghost" className="min-h-[44px] -ml-2" onClick={() => navigate("/admin/visits")}>
        <ArrowLeft className="h-4 w-4 mr-1" />My visits
      </Button>
      <div className="rounded-xl border border-border/60 bg-card p-4 space-y-2">
        <h1 className="text-lg font-semibold">{r.customer_name || "Client"}</h1>
        {r.address && <p className="text-sm text-muted-foreground">{r.address}</p>}
        <p className="text-sm flex items-center gap-1"><CalendarDays className="h-4 w-4" />{when(r)}</p>
        <div className="grid grid-cols-2 gap-2 pt-1">
          {r.phone ? (
            <Button asChild variant="outline" className="min-h-[44px]"><a href={`tel:${r.phone}`}><Phone className="h-4 w-4 mr-1" />Call</a></Button>
          ) : <Button variant="outline" className="min-h-[44px]" disabled><Phone className="h-4 w-4 mr-1" />No phone</Button>}
          {nav ? (
            <Button asChild variant="outline" className="min-h-[44px]"><a href={nav} target="_blank" rel="noreferrer"><Navigation className="h-4 w-4 mr-1" />Navigate</a></Button>
          ) : <Button variant="outline" className="min-h-[44px]" disabled><Navigation className="h-4 w-4 mr-1" />No address</Button>}
        </div>
        {r.notes && <p className="text-sm whitespace-pre-wrap border-t pt-2">{r.notes}</p>}
      </div>

      {tab === "available" && (
        <Button className="w-full min-h-[48px]" onClick={() => setAccepting(true)} data-testid="visit-accept">Accept this visit</Button>
      )}

      {tab !== "available" && (
        <div className="rounded-xl border border-border/60 bg-card p-4 space-y-2" data-testid="visit-quote-block">
          <h2 className="text-sm font-semibold">Quote</h2>
          {r.quote_id ? (
            <Button asChild variant="outline" className="w-full min-h-[44px] justify-between">
              <Link to={`/admin/estimates/${r.quote_id}`}>
                <span>Open quote {r.quote_number ?? ""} · {r.quote_status}</span>
                {r.quote_total != null && <span className="font-semibold">{money(r.quote_total)}</span>}
              </Link>
            </Button>
          ) : (
            <Button className="w-full min-h-[44px]" onClick={createQuote} data-testid="visit-create-quote">
              <PlusCircle className="h-4 w-4 mr-1" />Create quote
            </Button>
          )}
        </div>
      )}

      {tab !== "available" && <SitePhotosSection leadId={r.lead_id} />}

      {r.quote_accepted && r.quote_id && (
        <div className="rounded-xl border border-border/60 bg-card p-4" data-testid="visit-handover">
          <AcceptedWorkSection quoteId={r.quote_id} />
        </div>
      )}

      <AcceptLeadDialog
        lead={{ id: r.lead_id, customer_id: r.customer_id, customer_name: r.customer_name, customer_address: r.address,
          service_type: "Sales/Consultation", // visits are sales-lane by construction (get_my_visits)
          latitude: r.lat, longitude: r.lng, notes: r.notes }}
        open={accepting}
        onOpenChange={setAccepting}
        defaultAgentId={user?.id}
        onDone={() => { setAccepting(false); qc.invalidateQueries({ queryKey: ["my-visits"] }); }}
      />
    </div>
  );
};

export default AdminVisitsPage;
