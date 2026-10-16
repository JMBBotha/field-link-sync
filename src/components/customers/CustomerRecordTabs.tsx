import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import SitePhotosSection from "@/components/photos/SitePhotosSection";
import { Button } from "@/components/ui/button";

/** Client page tabs that were missing (Payments / Photos / Documents / History). Read-only; no messages sent. */
const sb = supabase as any;
const d = (v?: string | null) => (v ? format(new Date(v), "dd MMM yyyy HH:mm") : "—");
const rand = (n: number) => "R " + (Number(n) || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function CustomerPaymentsTab({ invoices }: { invoices: any[] }) {
  const ids = invoices.map((i) => i.id);
  const num = new Map(invoices.map((i) => [i.id, i.invoice_number]));
  const { data = [] } = useQuery({
    queryKey: ["cust-payments", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => (await sb.from("payments").select("id,invoice_id,amount,payment_date,method,reference,status").in("invoice_id", ids).order("payment_date", { ascending: false })).data || [],
  });
  return (
    <div className="p-4 overflow-auto max-h-[560px]" data-testid="cust-payments">
      {data.length === 0 ? <p className="text-sm text-muted-foreground">No payments recorded.</p> : (
        <table className="w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th className="py-1">Date</th><th>Invoice</th><th>Method</th><th>Reference</th><th>Status</th><th className="text-right">Amount</th></tr></thead>
          <tbody>{data.map((p: any) => (
            <tr key={p.id} className="border-t"><td className="py-1.5">{p.payment_date ? format(new Date(p.payment_date), "dd MMM yyyy") : "—"}</td><td>{num.get(p.invoice_id) || "—"}</td><td>{p.method || "—"}</td><td>{p.reference || "—"}</td><td>{p.status || "—"}</td><td className="text-right font-medium">{rand(p.amount)}</td></tr>
          ))}</tbody></table>
      )}
    </div>
  );
}

function useCustomerLeadIds(customerId: string, jobs: any[]) {
  const { data = [] } = useQuery({
    queryKey: ["cust-leads", customerId],
    queryFn: async () => (await sb.from("leads").select("id,created_at").eq("customer_id", customerId).is("deleted_at", null).order("created_at", { ascending: false }).limit(50)).data || [],
  });
  return Array.from(new Set([...data.map((l: any) => l.id), ...jobs.map((j) => j.lead_id).filter(Boolean)])) as string[];
}

export function CustomerPhotosTab({ customerId, jobs }: { customerId: string; jobs: any[] }) {
  const leadIds = useCustomerLeadIds(customerId, jobs);
  if (!leadIds.length) return <p className="p-4 text-sm text-muted-foreground">No photos yet.</p>;
  return <div className="p-4 space-y-4" data-testid="cust-photos">{leadIds.map((id) => <SitePhotosSection key={id} leadId={id} />)}</div>;
}

export function CustomerDocumentsTab({ customerId, quotes }: { customerId: string; quotes: any[] }) {
  const qids = quotes.map((q) => q.id);
  const qnum = new Map(quotes.map((q) => [q.id, q.quote_number]));
  const { data: docs = [] } = useQuery({
    queryKey: ["cust-docs", customerId],
    queryFn: async () => (await sb.from("purchase_order_documents").select("id,doc_type,file_name,storage_path,internal_only,created_at").eq("customer_id", customerId).order("created_at", { ascending: false })).data || [],
  });
  const { data: atts = [] } = useQuery({
    queryKey: ["cust-quote-atts", qids.join(",")],
    enabled: qids.length > 0,
    queryFn: async () => (await sb.from("quote_attachments").select("id,quote_id,filename,storage_path,caption,created_at").in("quote_id", qids).order("created_at", { ascending: false })).data || [],
  });
  const open = async (bucket: string, path: string) => {
    const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
  };
  const rows = [
    ...docs.map((x: any) => ({ id: x.id, name: x.file_name, kind: (x.doc_type || "Document") + (x.internal_only ? " · internal" : ""), at: x.created_at, bucket: "po-documents", path: x.storage_path })),
    ...atts.map((x: any) => ({ id: x.id, name: x.filename || x.caption || "Attachment", kind: "Quote " + (qnum.get(x.quote_id) || ""), at: x.created_at, bucket: "quote-photos", path: x.storage_path })),
  ];
  return (
    <div className="p-4" data-testid="cust-documents">
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">No documents yet.</p> : (
        <ul className="divide-y text-sm">{rows.map((r) => (
          <li key={r.id} className="py-2 flex items-center justify-between gap-2"><div className="min-w-0"><div className="truncate font-medium">{r.name}</div><div className="text-xs text-muted-foreground">{r.kind} · {d(r.at)}</div></div>
            <Button size="sm" variant="outline" onClick={() => open(r.bucket, r.path)}>Open</Button></li>
        ))}</ul>
      )}
    </div>
  );
}

export function CustomerHistoryTab({ customerId, quotes, invoices, jobs }: { customerId: string; quotes: any[]; invoices: any[]; jobs: any[] }) {
  const leadIds = useCustomerLeadIds(customerId, jobs);
  const label = new Map<string, string>();
  quotes.forEach((q) => label.set(q.id, "Quote " + (q.quote_number || "")));
  invoices.forEach((i) => label.set(i.id, "Invoice " + (i.invoice_number || "")));
  jobs.forEach((j) => label.set(j.id, "Job " + (j.title || "")));
  leadIds.forEach((l) => label.set(l, label.get(l) || "Lead"));
  const ids = [...label.keys()];
  const jobIds = jobs.map((j) => j.id);
  const { data = [] } = useQuery({
    queryKey: ["cust-history", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: async () => {
      const a = (await sb.from("status_change_log").select("id,entity_id,field_name,old_status,new_status,created_at").in("entity_id", ids.slice(0, 300)).order("created_at", { ascending: false }).limit(200)).data || [];
      const b = jobIds.length ? (await sb.from("job_activity_log").select("id,job_id,action,details,created_at").in("job_id", jobIds.slice(0, 300)).order("created_at", { ascending: false }).limit(200)).data || [] : [];
      return [
        ...a.map((x: any) => ({ id: "s" + x.id, at: x.created_at, what: label.get(x.entity_id) || "", text: `${(x.field_name || "status").replace(/_/g, " ")}: ${x.old_status ?? "—"} → ${x.new_status ?? "—"}` })),
        ...b.map((x: any) => ({ id: "j" + x.id, at: x.created_at, what: label.get(x.job_id) || "", text: x.action + (x.details && typeof x.details === "object" && x.details.note ? ` – ${x.details.note}` : "") })),
      ].sort((p, q) => (q.at || "").localeCompare(p.at || ""));
    },
  });
  return (
    <div className="p-4 max-h-[560px] overflow-auto" data-testid="cust-history">
      {data.length === 0 ? <p className="text-sm text-muted-foreground">No history yet.</p> : (
        <ul className="space-y-1.5 text-sm">{data.map((h: any) => (
          <li key={h.id} className="flex gap-3"><span className="w-36 shrink-0 text-xs text-muted-foreground">{d(h.at)}</span><span className="w-40 shrink-0 truncate text-xs font-medium">{h.what}</span><span className="min-w-0 break-words">{h.text}</span></li>
        ))}</ul>
      )}
    </div>
  );
}
