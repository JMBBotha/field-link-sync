import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { formatRand } from "@/utils/formatRand";
import { printStatement, TYPE_LABEL, type Statement } from "@/lib/statements";

/** Client-facing statement via a link the office copied (last 12 months). */
export default function PublicStatement() {
  const { token } = useParams<{ token: string }>();
  const [st, setSt] = useState<Statement | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing">("loading");
  useEffect(() => {
    (async () => {
      const { data, error } = await (supabase as any).rpc("get_public_statement", { p_token: token });
      if (error || !data) return setState("missing");
      setSt(data as Statement);
      setState("ok");
    })();
  }, [token]);

  if (state === "loading") return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (state === "missing" || !st) return <div className="flex min-h-screen items-center justify-center p-6 text-center text-muted-foreground">This statement link has expired or is no longer available. Please contact us for a new one.</div>;
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-8" data-testid="public-statement">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Statement</h1>
          <p className="text-sm text-muted-foreground">{st.from} to {st.to}</p>
          <p className="mt-2 font-medium">{st.customer?.name}</p>
          {st.customer?.company_name && <p className="text-sm">{st.customer.company_name}</p>}
        </div>
        <div className="text-right text-sm">
          <p className="font-semibold">{st.company?.company_name}</p>
          <p className="whitespace-pre-line text-muted-foreground">{st.company?.physical_address}</p>
        </div>
      </div>
      <div className="rounded-lg border p-3"><span className="text-sm text-muted-foreground">Balance due</span><div className="text-2xl font-bold">{formatRand(Number(st.closing_balance))}</div></div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-2 pr-2">Date</th><th className="pr-2">Details</th><th className="pr-2 text-right">Debit</th><th className="pr-2 text-right">Credit</th><th className="text-right">Balance</th></tr></thead>
          <tbody>
            <tr className="border-b"><td className="py-2 pr-2">{st.from}</td><td className="pr-2 text-muted-foreground" colSpan={3}>Opening balance</td><td className="text-right">{formatRand(Number(st.opening_balance))}</td></tr>
            {st.rows.map((r, i) => (
              <tr key={i} className="border-b">
                <td className="py-2 pr-2 whitespace-nowrap">{r.date}</td>
                <td className="pr-2">{TYPE_LABEL[r.type]} {r.ref}</td>
                <td className="pr-2 text-right">{r.debit ? formatRand(Number(r.debit)) : ""}</td>
                <td className="pr-2 text-right">{r.credit ? formatRand(Number(r.credit)) : ""}</td>
                <td className="text-right">{formatRand(Number(r.balance))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button variant="outline" onClick={() => printStatement(st)}><Printer className="mr-1 h-4 w-4" />Print / save PDF</Button>
    </div>
  );
}
