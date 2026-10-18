/**
 * P5 Site Survey Report: staff (/admin/visits/:leadId/survey/report) and the assigned tech (/field/survey/:leadId).
 * Read-only, no prices, never shown to the client. PDF is built on the phone and (staff) stored in the private site-surveys bucket.
 */
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck, Download, FileText, Loader2, MapPin, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCompany } from "@/providers/CompanyProvider";
import { useToast } from "@/hooks/use-toast";
import FieldShell from "@/components/field/FieldShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FrontPhoto, RoomCard, useSurveyPack } from "@/components/survey/SurveyPackSection";
import { ACCESS_FLAGS, btuLabel } from "@/lib/siteSurvey/model";
import { SURVEY_BUCKET, signedSurveyUrl } from "@/lib/siteSurvey/sync";
import { getBlob } from "@/lib/siteSurvey/store";
import { buildSurveyReportPdf } from "@/lib/siteSurvey/reportPdf";
import { startQuoteFromSurvey } from "@/lib/siteSurvey/quoteFromSurvey";
import brandCard from "@/assets/massair-0800-becool-card.png";

async function bytesOf(url: string): Promise<Uint8Array | null> {
  try { const r = await fetch(url); return r.ok ? new Uint8Array(await r.arrayBuffer()) : null; } catch { return null; }
}

export function SurveyReportBody({ leadId, field }: { leadId: string; field: boolean }) {
  const { user } = useAuth();
  const { company } = useCompany() as any;
  const { toast } = useToast();
  const navigate = useNavigate();
  const pack = useSurveyPack(leadId);
  const d = pack.data;
  const meta = useQuery({
    queryKey: ["survey-report-meta", leadId],
    queryFn: async () => {
      const sb = supabase as any;
      const [{ data: lead }, { data: s }] = await Promise.all([
        sb.from("leads").select("customer_name, customer_address").eq("id", leadId).maybeSingle(),
        sb.from("site_surveys").select("completed_at, started_at, created_by").eq("lead_id", leadId).is("archived_at", null).maybeSingle(),
      ]);
      let rep: string | null = null;
      if (s?.created_by) { const { data: p } = await sb.from("profiles").select("full_name").eq("id", s.created_by).maybeSingle(); rep = p?.full_name ?? null; }
      return { lead, when: s?.completed_at || s?.started_at || null, rep };
    },
  });
  const [busy, setBusy] = useState<"pdf" | "quote" | null>(null);

  const pdf = async () => {
    if (!d) return;
    setBusy("pdf");
    try {
      const logoUrl = company?.logo_url?.trim() || brandCard;
      const bytes = await buildSurveyReportPdf({
        survey: d, client: { name: meta.data?.lead?.customer_name, address: meta.data?.lead?.customer_address },
        companyName: company?.name ?? null, repName: meta.data?.rep ?? null, date: meta.data?.when ?? null,
        logo: (await bytesOf(logoUrl)) ?? (await bytesOf(brandCard)),
        image: async (path) => { const b = await getBlob(path); if (b) return new Uint8Array(await b.blob.arrayBuffer()); const u = await signedSurveyUrl(path); return u ? bytesOf(u) : null; },
      });
      const blob = new Blob([bytes], { type: "application/pdf" });
      if (!field) {
        // Private copy next to the photos ({company}/{survey}/report.pdf); techs only download.
        await supabase.storage.from(SURVEY_BUCKET).upload(`${d.companyId}/${d.id}/report.pdf`, blob, { upsert: true, contentType: "application/pdf" });
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = `${d.report_no || "site-survey"}.pdf`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    } catch (e: any) {
      toast({ title: "Couldn't make the PDF", description: e?.message, variant: "destructive" });
    } finally { setBusy(null); }
  };
  const quote = async () => {
    if (!d || !user) return;
    setBusy("quote");
    try { const id = await startQuoteFromSurvey(d, user.id); navigate(`/admin/quote-builder?quoteId=${id}`); }
    catch (e: any) { toast({ title: "Couldn't start the quote", description: e?.message, variant: "destructive" }); }
    finally { setBusy(null); }
  };

  if (pack.isLoading) return <p className="text-sm text-muted-foreground">Loading survey…</p>;
  if (!d) return <Card><CardContent className="p-4 text-sm">No site survey for this visit yet.</CardContent></Card>;
  const access = ACCESS_FLAGS.filter((f) => d.access_flags?.[f.key]).map((f) => f.label);
  return (
    <div className="space-y-3" data-testid="survey-report">
      <Card className="overflow-hidden">
        <FrontPhoto survey={d} className="aspect-[16/9] rounded-none" />
        <CardContent className="space-y-2 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="v8-eyebrow">Site survey report</div>
            <Badge variant={d.status === "complete" ? "default" : "outline"}>{d.report_no || "Draft"}</Badge>
          </div>
          <h2 className="text-lg font-semibold">{meta.data?.lead?.customer_name || "Client"}</h2>
          {meta.data?.lead?.customer_address && <p className="flex items-start gap-1 text-sm text-muted-foreground"><MapPin className="mt-0.5 h-4 w-4 shrink-0" />{meta.data.lead.customer_address}</p>}
          <p className="text-xs text-muted-foreground">
            {[meta.data?.when ? new Date(meta.data.when).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Johannesburg" }) : null, meta.data?.rep ? `by ${meta.data.rep}` : null].filter(Boolean).join(" · ")}
          </p>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button variant="outline" className="min-h-[44px]" onClick={pdf} disabled={busy !== null} data-testid="report-pdf">
              {busy === "pdf" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />}PDF
            </Button>
            {!field ? (
              <Button asChild variant="outline" className="min-h-[44px]"><Link to={`/admin/visits/${leadId}/survey`}><Pencil className="mr-1 h-4 w-4" />Edit survey</Link></Button>
            ) : <span />}
          </div>
          {!field && (
            <Button className="w-full min-h-[48px]" onClick={quote} disabled={busy !== null} data-testid="report-start-quote">
              {busy === "quote" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileText className="mr-1 h-4 w-4" />}
              {d.quote_id ? "Open quote" : "Start quote from survey"}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card><CardContent className="p-0">
        <p className="flex items-center gap-2 border-b px-4 py-2 text-sm font-semibold"><ClipboardCheck className="h-4 w-4" />Rooms · {d.rooms.length}</p>
        {d.rooms.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-2 border-b px-4 py-2 text-sm last:border-0" data-testid="report-room-line">
            <span className="min-w-0 truncate font-semibold">{r.name}</span>
            <span className="shrink-0 text-muted-foreground">{[btuLabel(r.unit_size_btu), r.pipe_run_m != null ? `${r.pipe_run_m} m` : null, r.wall_type].filter(Boolean).join(" · ")}</span>
          </div>
        ))}
      </CardContent></Card>

      {(d.access_note || access.length > 0) && (
        <Card><CardContent className="space-y-2 p-4">
          <h2 className="text-sm font-semibold">Access</h2>
          {access.length > 0 && <div className="flex flex-wrap gap-1.5">{access.map((f) => <Badge key={f} variant="secondary">{f}</Badge>)}</div>}
          {d.access_note && <p className="whitespace-pre-wrap text-sm">{d.access_note}</p>}
        </CardContent></Card>
      )}
      {d.rooms.map((r, i) => <RoomCard key={r.id} d={d} r={r} i={i} />)}
      <p className="px-1 text-xs text-muted-foreground">For staff and technicians. No prices. Not shared with the client.</p>
    </div>
  );
}

export default function SiteSurveyReportPage({ field = false }: { field?: boolean }) {
  const { leadId = "" } = useParams();
  if (field) return <FieldShell title="Survey report" back><SurveyReportBody leadId={leadId} field /></FieldShell>;
  return <div className="mx-auto max-w-3xl p-4 pb-32"><SurveyReportBody leadId={leadId} field={false} /></div>;
}
