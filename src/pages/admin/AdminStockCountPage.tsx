import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { sb } from "@/components/supplierDocs/api";

type HandRow = { bucket: string; stock_item_id: string; item_label: string; qty: number; value_excl: number };
type GeneralUnit = { id: string; supplier_code: string | null; half: string | null; serial_no: string | null };
type JobOpt = { id: string; label: string };

const BUCKET: Record<string, string> = { material_pool: "Materials pool", job_unit: "Job-reserved units", general_unit: "General stock" };

/** Admin stock count. Posts one adjustment per line that differs. Does not edit past movements. */
export default function AdminStockCountPage() {
  const { toast } = useToast();
  const { data: companyId } = useQuery({
    queryKey: ["my-company-id"],
    queryFn: async () => (await sb.rpc("caller_company_id")).data as string | null,
  });
  const hand = useQuery({
    queryKey: ["stock-on-hand", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await sb.rpc("stock_on_hand", { p_company: companyId });
      if (error) throw error;
      return (data ?? []) as HandRow[];
    },
  });
  const general = useQuery({
    queryKey: ["stock-general-units", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await sb.rpc("stock_general_units", { p_company: companyId });
      if (error) throw error;
      return (data ?? []) as GeneralUnit[];
    },
  });
  const jobs = useQuery({
    queryKey: ["stock-count-jobs", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await sb.from("jobs").select("id, title, status").eq("company_id", companyId).neq("status", "cancelled").order("created_at", { ascending: false }).limit(150);
      if (error) throw error;
      return ((data ?? []) as { id: string; title: string | null }[]).map((j) => ({ id: j.id, label: j.title || j.id.slice(0, 8) })) as JobOpt[];
    },
  });
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [assignJob, setAssignJob] = useState<Record<string, string>>({});

  const key = (r: HandRow) => `${r.bucket}:${r.stock_item_id}`;
  const post = async () => {
    if (!companyId) return;
    const lines = (hand.data ?? []).map((r) => {
      const raw = counted[key(r)];
      const qty = raw == null || raw === "" ? Number(r.qty) : Number(raw);
      return { stock_item_id: r.stock_item_id, bucket: r.bucket, counted_qty: qty, reason: reason[key(r)] || null };
    }).filter((l) => Number.isFinite(l.counted_qty));
    setBusy(true);
    const { data: id, error } = await sb.rpc("stock_count_save", { p_company: companyId, p_counted_on: new Date().toISOString().slice(0, 10), p_lines: lines });
    if (error) { setBusy(false); return toast({ title: "Count not saved", description: error.message, variant: "destructive" }); }
    const { data: posted, error: e2 } = await sb.rpc("stock_count_post", { p_count: id });
    setBusy(false);
    if (e2) return toast({ title: "Count not posted", description: e2.message, variant: "destructive" });
    toast({ title: posted?.already ? "Already posted" : `Posted ${posted?.posted ?? 0} adjustment(s)` });
    setCounted({}); setReason({});
    hand.refetch();
  };
  const assign = async (unitId: string) => {
    const job = assignJob[unitId];
    if (!job) return;
    const { error } = await sb.rpc("stock_assign_unit", { p_unit: unitId, p_job: job });
    if (error) return toast({ title: "Not assigned", description: error.message, variant: "destructive" });
    toast({ title: "Unit moved onto the job" });
    general.refetch(); hand.refetch();
  };
  const seed = async () => {
    if (!companyId) return;
    const { error } = await sb.rpc("material_allowance_seed_stubs", { p_company: companyId });
    if (error) return toast({ title: "Stubs not added", description: error.message, variant: "destructive" });
    toast({ title: "Allowance stubs added", description: "They stay inactive until WALDA fills the quantities." });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4" data-testid="stock-count-page">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Stock count</h1>
        <Button size="sm" variant="outline" onClick={seed}>Add allowance stubs</Button>
      </div>
      <p className="text-xs text-muted-foreground">System quantity comes from the movement ledger. Posting writes one adjustment per line that differs, with a reason. Past movements are not edited. Supplier costs stay on this admin screen.</p>
      {hand.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : hand.error ? <p className="text-sm text-muted-foreground">Stock ledger is not available yet.</p> : !(hand.data ?? []).length ? <p className="text-sm text-muted-foreground">No stock movements yet.</p> : (
        <div className="space-y-2">
          {(hand.data ?? []).map((r) => (
            <div key={key(r)} className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[1.4fr_.8fr_.6fr_.8fr]">
              <div>
                <div className="text-sm font-medium">{r.item_label}</div>
                <div className="text-[11px] text-muted-foreground">{BUCKET[r.bucket] ?? r.bucket} · system {r.qty}</div>
              </div>
              <div className="text-sm text-muted-foreground sm:text-right">R{Number(r.value_excl).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <Input aria-label={`Counted ${r.item_label}`} inputMode="decimal" placeholder={String(r.qty)} value={counted[key(r)] ?? ""} onChange={(e) => setCounted((s) => ({ ...s, [key(r)]: e.target.value }))} />
              <Input aria-label={`Reason ${r.item_label}`} placeholder="Reason if different" value={reason[key(r)] ?? ""} onChange={(e) => setReason((s) => ({ ...s, [key(r)]: e.target.value }))} />
            </div>
          ))}
          <div className="flex justify-end"><Button disabled={busy} onClick={post}>{busy ? "Posting…" : "Post count"}</Button></div>
        </div>
      )}
      <section className="space-y-2">
        <h2 className="font-semibold">General stock units</h2>
        <p className="text-xs text-muted-foreground">Assign a unit that was received into general stock onto an existing job. A unit already received against a job cannot be moved this way.</p>
        {(general.data ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No unassigned units.</p> : (general.data ?? []).map((u) => (
          <div key={u.id} className="flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1 text-sm">{u.half ? `${u.half} · ` : ""}{u.supplier_code || "Unit"}{u.serial_no ? ` · ${u.serial_no}` : ""}</div>
            <select aria-label="Job" className="h-9 rounded-md border bg-background px-2 text-sm" value={assignJob[u.id] ?? ""} onChange={(e) => setAssignJob((s) => ({ ...s, [u.id]: e.target.value }))}>
              <option value="">Choose job…</option>
              {(jobs.data ?? []).map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}
            </select>
            <Button size="sm" variant="outline" disabled={!assignJob[u.id]} onClick={() => assign(u.id)}>Assign to job</Button>
          </div>
        ))}
      </section>
    </div>
  );
}
