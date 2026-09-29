/**
 * Owner-only "Where the money goes" (Job 4). Data comes from get_owner_money_flow(), which returns
 * null for anyone who is not the company owner — the section then renders nothing.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { formatRand } from "@/utils/formatRand";
import { GROUPS, groupTotals, monthlyGroups, viewTotals, waterfall, type FlowView, type MoneyFlow } from "@/lib/moneyFlow";

const VIEWS: { key: FlowView; label: string }[] = [
  { key: "earned", label: "Earned (paid in full)" },
  { key: "pending", label: "Pending" },
  { key: "all", label: "All" },
];
const short = (n: number) => (Math.abs(n) >= 1000 ? `R${Math.round(n / 1000)}k` : `R${Math.round(n)}`);

export default function OwnerMoneyFlow() {
  const [view, setView] = useState<FlowView>("earned");
  const { data: flow } = useQuery({
    queryKey: ["owner-money-flow"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_owner_money_flow", {});
      if (error) return null;
      return (data ?? null) as MoneyFlow | null;
    },
  });
  if (!flow) return null;

  const t = viewTotals(flow, view);
  const g = groupTotals(flow.segments, t.segments);
  const bars = waterfall(flow.segments, t.revenue, t.segments);
  const months = monthlyGroups(flow, view);
  const tiles: [string, number, string][] = [
    ["Revenue ex VAT", t.revenue, "#0f172a"],
    ...GROUPS.map((x) => [x.label, g[x.key], x.color] as [string, number, string]),
  ];

  return (
    <Card className="surface-card-solid" data-testid="owner-money-flow">
      <CardContent className="space-y-3 p-3 md:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Where the money goes · owner only</h2>
            <p className="text-[11px] text-muted-foreground">{t.quotes} jobs · ex VAT · labour cost is the tech share (counted once)</p>
          </div>
          <div className="flex gap-1">
            {VIEWS.map((v) => (
              <button key={v.key} onClick={() => setView(v.key)}
                className={`rounded-md px-2 py-1 text-[11px] font-medium ${view === v.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}>
                {v.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {tiles.map(([label, amount, color]) => (
            <div key={label} className="rounded-lg bg-muted/50 p-2">
              <p className="flex items-center gap-1 text-[11px] text-muted-foreground"><span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />{label}</p>
              <p className="text-sm font-bold tabular-nums text-foreground">{formatRand(amount)}</p>
            </div>
          ))}
        </div>

        {/* Phones: monthly stacked bar */}
        <div className="h-56 md:hidden">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={months}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 10 }} />
              <YAxis tickFormatter={short} tick={{ fontSize: 10 }} width={44} />
              <Tooltip formatter={(v: number, n: string) => [formatRand(Number(v)), GROUPS.find((x) => x.key === n)?.label ?? n]} />
              {GROUPS.map((x) => <Bar key={x.key} dataKey={x.key} stackId="m" fill={x.color} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Wider screens: waterfall */}
        <div className="hidden h-72 md:block">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bars}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} />
              <YAxis tickFormatter={short} tick={{ fontSize: 10 }} width={52} />
              <Tooltip formatter={(v: number, n: string, p: any) => (n === "base" ? null : [formatRand(Number(p?.payload?.amount ?? v)), p?.payload?.name])} />
              <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
              <Bar dataKey="value" stackId="w">
                {bars.map((b) => <Cell key={b.name} fill={b.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="space-y-1 text-xs">
          {flow.segments.map((d) => (
            <div key={d.key} className="flex justify-between gap-2">
              <span className="text-muted-foreground">{d.label}</span>
              <span className="tabular-nums">{formatRand(t.segments[d.key] ?? 0)}</span>
            </div>
          ))}
        </div>

        <table className="w-full text-sm">
          <thead><tr className="border-b text-[11px] text-muted-foreground">
            <th className="py-1 text-left font-medium">Person</th>
            <th className="py-1 text-right font-medium">Earned</th>
            <th className="py-1 text-right font-medium">Pending</th>
          </tr></thead>
          <tbody>
            {flow.people.map((p) => (
              <tr key={`${p.role}-${p.profile_id ?? "none"}`} className="border-b border-border/50">
                <td className="py-1"><span className="font-medium">{p.name}</span> <span className="text-[11px] text-muted-foreground">{p.role === "sales" ? "Sales" : "Tech"} · {p.quotes} {p.quotes === 1 ? "job" : "jobs"}</span></td>
                <td className="py-1 text-right tabular-nums">{formatRand(Number(p.earned) || 0)}</td>
                <td className="py-1 text-right tabular-nums text-muted-foreground">{formatRand(Number(p.pending) || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
