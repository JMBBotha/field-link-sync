import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { fetchMoneySummary, type MoneyFilter } from "@/lib/moneySummary";
import { formatRand } from "@/utils/formatRand";

const MoneySummaryCard = () => {
  const { companyId } = useUserCompanyId();
  const navigate = useNavigate();
  const { data } = useQuery({
    queryKey: ["money-summary", companyId],
    queryFn: () => fetchMoneySummary(companyId!),
    enabled: !!companyId,
  });

  const tiles: { key: MoneyFilter; label: string; b?: { count: number; balance: number } }[] = [
    { key: "deposits_due", label: "Deposits due", b: data?.depositsDue },
    { key: "partially_paid", label: "Partially paid", b: data?.partiallyPaid },
    { key: "outstanding", label: "Outstanding", b: data?.outstanding },
  ];

  return (
    <Card className="surface-card-solid">
      <CardContent className="p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Money</p>
        <div className="grid grid-cols-3 gap-2">
          {tiles.map((t) => (
            <button
              key={t.key}
              onClick={() => navigate(`/admin/invoices?money=${t.key}`)}
              className="rounded-lg bg-muted/50 p-2 text-left hover:bg-muted transition-colors"
            >
              <p className="text-[11px] text-muted-foreground">{t.label} · {t.b?.count ?? 0}</p>
              <p className="text-sm font-bold text-foreground">{formatRand(t.b?.balance ?? 0)}</p>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default MoneySummaryCard;
