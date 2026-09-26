import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { fetchLeadMoney, fetchMoneySummary } from "@/lib/moneySummary";
import { formatRand } from "@/utils/formatRand";
import { Loader2 } from "lucide-react";

/** Money per lead: deposit due, paid, balance — biggest balance first. Row opens the lead's quote (or invoice). */
const AdminMoneyPage = () => {
  const { companyId } = useUserCompanyId();
  const navigate = useNavigate();
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["lead-money", companyId],
    queryFn: () => fetchLeadMoney(companyId!),
    enabled: !!companyId,
  });
  const { data: sum } = useQuery({
    queryKey: ["money-summary", companyId],
    queryFn: () => fetchMoneySummary(companyId!),
    enabled: !!companyId,
  });

  return (
    <div className="space-y-3 p-3 md:p-6">
      <h1 className="text-xl font-bold text-foreground">Money by lead</h1>
      <div className="grid grid-cols-3 gap-2">
        {[
          ["Deposits due", sum?.depositsDue],
          ["Partially paid", sum?.partiallyPaid],
          ["Outstanding", sum?.outstanding],
        ].map(([label, b]: any) => (
          <Card key={label} className="surface-card-solid"><CardContent className="p-3">
            <p className="text-[11px] text-muted-foreground">{label} · {b?.count ?? 0}</p>
            <p className="text-sm font-bold text-foreground">{formatRand(b?.balance ?? 0)}</p>
          </CardContent></Card>
        ))}
      </div>
      <Card className="surface-card-solid overflow-hidden">
        {isLoading ? (
          <div className="p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Nothing outstanding.</p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-muted/50 text-muted-foreground">
              <th className="text-left px-3 py-2 font-medium">Lead</th>
              <th className="text-right px-3 py-2 font-medium">Deposit due</th>
              <th className="text-right px-3 py-2 font-medium">Paid</th>
              <th className="text-right px-3 py-2 font-medium">Balance</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.key}
                  className="border-b border-border/50 hover:bg-muted/30 cursor-pointer"
                  onClick={() => navigate(r.quoteId ? `/admin/estimates/${r.quoteId}` : `/admin/invoices/${r.firstInvoiceId}`)}
                >
                  <td className="px-3 py-2">
                    <p className="font-medium text-foreground">{r.customerName}</p>
                    <p className="text-xs text-muted-foreground">{r.invoiceNumbers.join(", ")}</p>
                  </td>
                  <td className="px-3 py-2 text-right">{formatRand(r.depositDue)}</td>
                  <td className="px-3 py-2 text-right">{formatRand(r.paid)}</td>
                  <td className="px-3 py-2 text-right font-semibold">{formatRand(r.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
};

export default AdminMoneyPage;
