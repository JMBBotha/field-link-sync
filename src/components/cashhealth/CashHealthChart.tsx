import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Forecast } from "@/lib/cashHealth";
import { rand0 } from "@/lib/cashHealth";

const k = (v: number) => `${v < 0 ? "−" : ""}R${Math.round(Math.abs(v) / 1000)}k`;

/** 13-week balance: expected (solid) vs cautious (dashed), R0 and buffer lines, lowest point marked. */
export function BalanceChart({ f, height = 240 }: { f: Forecast; height?: number }) {
  const rows = f.weeks.map((w, i) => ({ label: `W${i + 1}`, date: w.label, Expected: Math.round(w.balance), Cautious: Math.round(w.balanceCautious) }));
  const min = Math.min(0, ...rows.map((r) => Math.min(r.Expected, r.Cautious)));
  const low = rows[f.lowest.index];
  return (
    <div style={{ height }} data-testid="cash-health-balance-chart">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.4} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={2} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={k} width={48} />
          {min < 0 && <ReferenceArea y1={min * 1.1} y2={0} fill="#DC2626" fillOpacity={0.06} />}
          <ReferenceLine y={0} stroke="#DC2626" strokeDasharray="4 3" />
          {f.buffer > 0 && <ReferenceLine y={f.buffer} stroke="#D97706" strokeDasharray="2 4" label={{ value: "buffer", position: "insideTopRight", fontSize: 10, fill: "#B45309" }} />}
          <Tooltip labelFormatter={(_l, p) => (p?.[0]?.payload ? `Week of ${p[0].payload.date}` : "")} formatter={(v: number, n: string) => [rand0(Number(v)), n === "Cautious" ? "Cautious (late + confidence)" : "Expected"]} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line dataKey="Expected" stroke="#1590D6" strokeWidth={2.5} dot={{ r: 2.5 }} isAnimationActive={false} />
          <Line dataKey="Cautious" stroke="#64748B" strokeWidth={1.75} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
          {low && <ReferenceDot x={low.label} y={low.Expected} r={6} fill="none" stroke="#DC2626" strokeWidth={2} />}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Money in vs going out per week (units at cost, overheads, VAT). */
export function FlowBars({ f, height = 200 }: { f: Forecast; height?: number }) {
  const rows = f.weeks.map((w, i) => ({ label: `W${i + 1}`, date: w.label, In: Math.round(w.inExpected), Units: -Math.round(w.units), Overheads: -Math.round(w.overheads), VAT: -Math.round(w.vat) }));
  return (
    <div style={{ height }} data-testid="cash-health-flow-chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} stackOffset="sign" margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.4} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={2} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={k} width={48} />
          <ReferenceLine y={0} stroke="#94A3B8" />
          <Tooltip labelFormatter={(_l, p) => (p?.[0]?.payload ? `Week of ${p[0].payload.date}` : "")} formatter={(v: number, n: string) => [rand0(Math.abs(Number(v))), n === "Units" ? "Units & materials (cost)" : n]} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="In" stackId="a" fill="#16A34A" isAnimationActive={false} />
          <Bar dataKey="Units" stackId="a" fill="#F97316" isAnimationActive={false} />
          <Bar dataKey="Overheads" stackId="a" fill="#94A3B8" isAnimationActive={false} />
          <Bar dataKey="VAT" stackId="a" fill="#7C3AED" isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
