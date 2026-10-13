import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Week } from "@/lib/cashflow";
import { formatRand } from "@/utils/formatRand";

export default function CashflowChart({ weeks, withExpected, height = 220 }: { weeks: Week[]; withExpected: boolean; height?: number }) {
  const rows = weeks.map((w) => ({ label: w.label, In: Math.round(w.inflow), Out: -Math.round(w.outflow), Expected: Math.round(w.expected), Balance: Math.round(withExpected ? w.closingWithExpected : w.closing) }));
  return (
    <div style={{ height }} data-testid="cashflow-chart">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 6, right: 6, left: 0, bottom: 0 }} stackOffset="sign">
          <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.4} />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={36} />
          <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} width={40} />
          <Tooltip formatter={(v: number, n: string) => [formatRand(Math.abs(Number(v))), n === "Out" ? "Out (we pay)" : n === "In" ? "In (clients pay)" : n === "Expected" ? "Expected deposits" : "Projected balance"]} />
          <ReferenceLine y={0} stroke="#DC2626" strokeDasharray="4 3" />
          <Bar dataKey="In" stackId="a" fill="#16A34A" isAnimationActive={false} />
          {withExpected && <Bar dataKey="Expected" stackId="a" fill="#86EFAC" isAnimationActive={false} />}
          <Bar dataKey="Out" stackId="a" fill="#F97316" isAnimationActive={false} />
          <Line dataKey="Balance" stroke="#1E3A8A" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
