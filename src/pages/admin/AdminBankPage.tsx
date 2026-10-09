import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, EyeOff, Loader2, Search, Undo2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatRand } from "@/utils/formatRand";
import { parseFnbCsv, summarize, type ParseResult } from "@/lib/fnbCsv";
import { EXPENSE_CATEGORIES } from "@/lib/expenses";

interface Line { id: string; txn_date: string; amount: number; description: string | null; reference: string | null; status: "new" | "matched" | "ignored"; matched_payment_id: string | null; matched_expense_id: string | null; created_record: boolean; account_label: string; note: string | null }
interface Sugg { kind: "invoice" | "payment" | "expense"; target: string; label: string | null; who: string | null; amount: number; dt: string | null; score: number }
const KIND_LABEL: Record<Sugg["kind"], string> = { invoice: "Record payment on", payment: "Already recorded payment on", expense: "Existing expense" };

/** FNB CSV import + matching (office only). Suggestions need a click to confirm; a line can only be used once. */
export default function AdminBankPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [parsed, setParsed] = useState<(ParseResult & { name: string }) | null>(null);
  const [importing, setImporting] = useState(false);
  const [filter, setFilter] = useState<"new" | "matched" | "ignored">("new");
  const [open, setOpen] = useState<string | null>(null);
  const [sugg, setSugg] = useState<Record<string, Sugg[] | "loading">>({});
  const [cat, setCat] = useState<Record<string, string>>({});
  const [vat, setVat] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const { data: lines = [], isLoading } = useQuery({
    queryKey: ["bank-lines"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("bank_lines" as any) as any).select("*").order("txn_date", { ascending: false }).limit(1000);
      if (error) throw error;
      return (data || []) as Line[];
    },
  });
  const counts = useMemo(() => ({ new: lines.filter((l) => l.status === "new").length, matched: lines.filter((l) => l.status === "matched").length, ignored: lines.filter((l) => l.status === "ignored").length }), [lines]);
  const shown = lines.filter((l) => l.status === filter && (!q.trim() || `${l.description} ${l.reference} ${l.amount}`.toLowerCase().includes(q.trim().toLowerCase())));

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    const r = parseFnbCsv(await f.text());
    setParsed({ ...r, name: f.name });
    if (!r.lines.length) toast({ title: "No transactions found", description: "Download the CSV from FNB online banking (transaction history or statement CSV).", variant: "destructive" });
  };
  const doImport = async () => {
    if (!parsed?.lines.length) return;
    setImporting(true);
    const { data, error } = await (supabase as any).rpc("import_bank_lines", { p_lines: parsed.lines, p_account: parsed.account || "FNB" });
    setImporting(false);
    if (error) return toast({ title: "Import failed", description: error.message, variant: "destructive" });
    toast({ title: `Imported ${data.inserted} new line${data.inserted === 1 ? "" : "s"}`, description: data.duplicates ? `${data.duplicates} already imported — skipped.` : undefined });
    setParsed(null);
    setFilter("new");
    qc.invalidateQueries({ queryKey: ["bank-lines"] });
  };
  const loadSugg = async (l: Line) => {
    setOpen(open === l.id ? null : l.id);
    if (sugg[l.id] && sugg[l.id] !== "loading") return;
    setSugg((s) => ({ ...s, [l.id]: "loading" }));
    const { data, error } = await (supabase as any).rpc("bank_match_suggestions", { p_line: l.id });
    setSugg((s) => ({ ...s, [l.id]: error ? [] : ((data || []) as Sugg[]) }));
  };
  const confirm = async (l: Line, kind: string, target?: string) => {
    setBusy(l.id);
    const { error } = await (supabase as any).rpc("confirm_bank_line", { p_line: l.id, p_kind: kind, p_target: target ?? null, p_category: cat[l.id] || "bank_charges", p_vat_claimable: vat[l.id] ?? false, p_note: null });
    setBusy(null);
    if (error) return toast({ title: "Not matched", description: error.message, variant: "destructive" });
    toast({ title: kind === "ignore" ? "Line ignored" : "Matched", description: kind === "invoice" ? "Payment recorded on the invoice. Nothing was sent to the client." : undefined });
    setOpen(null);
    setSugg((s) => { const n = { ...s }; delete n[l.id]; return n; });
    qc.invalidateQueries({ queryKey: ["bank-lines"] });
  };
  const undo = async (l: Line) => {
    setBusy(l.id);
    const { error } = await (supabase as any).rpc("unmatch_bank_line", { p_line: l.id });
    setBusy(null);
    if (error) return toast({ title: "Could not undo", description: error.message, variant: "destructive" });
    toast({ title: "Match undone", description: l.created_record ? "The payment/expense it created was cancelled (kept for audit)." : undefined });
    qc.invalidateQueries({ queryKey: ["bank-lines"] });
  };

  const sum = parsed ? summarize(parsed.lines) : null;
  return (
    <div className="space-y-4 p-3 md:p-6" data-testid="bank-page">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Bank (FNB CSV)</h1>
        <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border bg-card px-3 py-2 text-sm font-medium hover:bg-muted">
          <Upload className="h-4 w-4" /> Upload CSV
          <input type="file" accept=".csv,text/csv" className="hidden" data-testid="bank-file" onChange={(e) => { onFile(e.target.files?.[0]); e.currentTarget.value = ""; }} />
        </label>
      </div>
      {parsed && sum && (
        <Card data-testid="bank-preview"><CardContent className="space-y-2 p-3 text-sm">
          <div className="font-medium">{parsed.name}{parsed.account ? ` · ${parsed.account}` : ""}</div>
          <div className="text-muted-foreground">{sum.count} transactions {sum.from ? `· ${sum.from} to ${sum.to}` : ""} · in {formatRand(sum.moneyIn)} · out {formatRand(sum.moneyOut)}{parsed.skipped ? ` · ${parsed.skipped} non-transaction rows skipped` : ""}</div>
          <div className="text-xs text-muted-foreground">Lines already imported are skipped automatically (same date, amount and reference).</div>
          <div className="flex gap-2">
            <Button size="sm" onClick={doImport} disabled={importing || !sum.count} data-testid="bank-import">{importing && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Import {sum.count}</Button>
            <Button size="sm" variant="outline" onClick={() => setParsed(null)}>Cancel</Button>
          </div>
        </CardContent></Card>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {(["new", "matched", "ignored"] as const).map((f) => (
          <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)} data-testid={`bank-filter-${f}`}>
            {f === "new" ? "To match" : f === "matched" ? "Matched" : "Ignored"} ({counts[f]})
          </Button>
        ))}
        <div className="relative min-w-[160px] flex-1"><Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" /><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="h-9 pl-8" /></div>
      </div>
      <Card><CardContent className="p-0">
        {isLoading ? <div className="p-6 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div> : (
          <ul className="divide-y">
            {shown.map((l) => {
              const s = sugg[l.id];
              return (
                <li key={l.id} className="space-y-2 p-3 text-sm" data-testid="bank-line">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{l.description || "—"}</div>
                      <div className="truncate text-xs text-muted-foreground">{l.txn_date}{l.reference ? ` · ${l.reference}` : ""} · {l.account_label}</div>
                    </div>
                    <div className={`whitespace-nowrap font-semibold ${l.amount > 0 ? "text-emerald-600" : ""}`}>{l.amount > 0 ? "+" : "−"}{formatRand(Math.abs(Number(l.amount)))}</div>
                  </div>
                  {l.status === "new" ? (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => loadSugg(l)} data-testid="bank-suggest">Match…</Button>
                      <Button size="sm" variant="ghost" onClick={() => confirm(l, "ignore")} disabled={busy === l.id}><EyeOff className="mr-1 h-4 w-4" />Ignore</Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{l.status === "ignored" ? "Ignored" : l.matched_payment_id ? (l.created_record ? "Payment recorded" : "Linked to payment") : l.created_record ? "Expense created" : "Linked to expense"}</Badge>
                      <Button size="sm" variant="ghost" onClick={() => undo(l)} disabled={busy === l.id}><Undo2 className="mr-1 h-4 w-4" />Undo</Button>
                    </div>
                  )}
                  {open === l.id && l.status === "new" && (
                    <div className="space-y-2 rounded-md border bg-muted/30 p-2" data-testid="bank-suggestions">
                      {s === "loading" && <Loader2 className="h-4 w-4 animate-spin" />}
                      {Array.isArray(s) && s.length === 0 && <p className="text-xs text-muted-foreground">No matching {l.amount > 0 ? "invoice or payment" : "expense"} (same amount, ref or date ±5 days).</p>}
                      {Array.isArray(s) && s.map((c) => (
                        <div key={c.kind + c.target} className="flex flex-wrap items-center gap-2" data-testid="bank-suggestion">
                          <div className="min-w-0 flex-1 text-xs"><span className="text-muted-foreground">{KIND_LABEL[c.kind]}</span> <span className="font-medium">{c.label}</span>{c.who ? ` · ${c.who}` : ""} · {formatRand(Number(c.amount))}{c.dt ? ` · ${c.dt}` : ""}</div>
                          <Button size="sm" onClick={() => confirm(l, c.kind, c.target)} disabled={busy === l.id} data-testid="bank-confirm"><Check className="mr-1 h-4 w-4" />Confirm</Button>
                        </div>
                      ))}
                      {l.amount < 0 && (
                        <div className="flex flex-wrap items-center gap-2 border-t pt-2">
                          <span className="text-xs">New expense:</span>
                          <Select value={cat[l.id] || "bank_charges"} onValueChange={(v) => setCat((x) => ({ ...x, [l.id]: v }))}>
                            <SelectTrigger className="h-8 w-[170px]"><SelectValue /></SelectTrigger>
                            <SelectContent>{EXPENSE_CATEGORIES.map(([k, lab]) => <SelectItem key={k} value={k}>{lab}</SelectItem>)}</SelectContent>
                          </Select>
                          <label className="flex items-center gap-1 text-xs"><Switch checked={vat[l.id] ?? false} onCheckedChange={(v) => setVat((x) => ({ ...x, [l.id]: v }))} />VAT</label>
                          <Button size="sm" variant="outline" onClick={() => confirm(l, "new_expense")} disabled={busy === l.id} data-testid="bank-new-expense">Create</Button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
            {shown.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">{filter === "new" ? "Nothing to match. Upload an FNB CSV to start." : "None."}</li>}
          </ul>
        )}
      </CardContent></Card>
    </div>
  );
}
