import { useEffect, useState } from "react";
import { Link2, Loader2, Printer, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatRand } from "@/utils/formatRand";
import { defaultRange, printStatement, statementLinkUrl, statementTotals, TYPE_LABEL, type Statement } from "@/lib/statements";

/** Office-only client statement: opening balance, invoices, payments, credit notes, running balance. */
export default function CustomerStatementPanel({ customerId }: { customerId: string }) {
  const { toast } = useToast();
  const [range, setRange] = useState(defaultRange());
  const [st, setSt] = useState<Statement | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  const load = async () => {
    setLoading(true);
    setErr(null);
    const { data, error } = await (supabase as any).rpc("customer_statement", { p_customer: customerId, p_from: range.from, p_to: range.to });
    setLoading(false);
    if (error) return setErr(error.message || "Could not load the statement.");
    setSt(data as Statement);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  const copyLink = async () => {
    setLinking(true);
    const { data, error } = await (supabase as any).rpc("create_statement_link", { p_customer: customerId });
    setLinking(false);
    if (error || !data) return toast({ title: "Could not create link", description: error?.message, variant: "destructive" });
    const url = statementLinkUrl(String(data));
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Statement link copied", description: "Valid 30 days. Nothing was sent to the client — share it yourself." });
    } catch {
      toast({ title: "Statement link", description: url });
    }
  };

  const t = st ? statementTotals(st) : null;
  return (
    <div data-testid="customer-statement" className="space-y-3 p-3 md:p-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="st-from" className="text-xs">From</Label>
          <Input id="st-from" type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className="h-9 w-[150px]" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="st-to" className="text-xs">To</Label>
          <Input id="st-to" type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className="h-9 w-[150px]" />
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}<span className="ml-1">Update</span>
        </Button>
        <Button size="sm" variant="outline" onClick={() => st && printStatement(st)} disabled={!st} data-testid="statement-print">
          <Printer className="h-4 w-4" /><span className="ml-1">Print / PDF</span>
        </Button>
        <Button size="sm" variant="outline" onClick={copyLink} disabled={linking} data-testid="statement-link">
          {linking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}<span className="ml-1">Copy client link</span>
        </Button>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      {st && t && (
        <>
          <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
            <div className="rounded-md border p-2"><div className="text-xs text-muted-foreground">Opening</div><div className="font-semibold">{formatRand(Number(st.opening_balance))}</div></div>
            <div className="rounded-md border p-2"><div className="text-xs text-muted-foreground">Invoiced</div><div className="font-semibold">{formatRand(t.invoiced)}</div></div>
            <div className="rounded-md border p-2"><div className="text-xs text-muted-foreground">Paid + credited</div><div className="font-semibold">{formatRand(t.paid + t.credited)}</div></div>
            <div className="rounded-md border p-2" data-testid="statement-closing"><div className="text-xs text-muted-foreground">Balance due</div><div className="font-semibold">{formatRand(Number(st.closing_balance))}</div></div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-2">Date</th><th className="pr-2">Type</th><th className="pr-2">Ref</th>
                  <th className="pr-2 text-right">Debit</th><th className="pr-2 text-right">Credit</th><th className="text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b"><td className="py-2 pr-2">{st.from}</td><td colSpan={4} className="pr-2 text-muted-foreground">Opening balance</td><td className="text-right">{formatRand(Number(st.opening_balance))}</td></tr>
                {st.rows.map((r, i) => (
                  <tr key={i} className="border-b" data-testid="statement-row">
                    <td className="py-2 pr-2 whitespace-nowrap">{r.date}</td>
                    <td className="pr-2">{TYPE_LABEL[r.type] || r.type}</td>
                    <td className="pr-2 whitespace-nowrap">{r.ref}</td>
                    <td className="pr-2 text-right whitespace-nowrap">{r.debit ? formatRand(Number(r.debit)) : ""}</td>
                    <td className="pr-2 text-right whitespace-nowrap">{r.credit ? formatRand(Number(r.credit)) : ""}</td>
                    <td className="text-right font-medium whitespace-nowrap">{formatRand(Number(r.balance))}</td>
                  </tr>
                ))}
                {st.rows.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">No activity in this period.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
