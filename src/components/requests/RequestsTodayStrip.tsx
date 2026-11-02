import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchToday, REQUEST_TYPES } from "@/lib/requests";

/** Home strip: today's requests per type (incl. service + move), needs sorting, and red "not contacted". */
/** `blue`: mid-blue glass for the admin home (Johan 2 Nov 18:29). */
export default function RequestsTodayStrip({ blue }: { blue?: boolean } = {}) {
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: ["requests-today"], queryFn: fetchToday, refetchInterval: 60_000 });
  if (!data) return null;
  return (
    <section className={blue ? "rounded-2xl border border-white/20 bg-gradient-to-br from-[#1478C8]/95 to-[#3D9BEB]/90 p-3 text-white shadow-md backdrop-blur-sm" : "glass-card rounded-2xl border p-3"} data-testid="requests-today" data-tone={blue ? "blue" : undefined}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className={`text-[13px] font-semibold uppercase tracking-wide ${blue ? "text-[#E8F6FE]" : "text-muted-foreground"}`}>Requests today · {data.in} in</h3>
        <button onClick={() => navigate("/admin/requests")} className={`min-h-11 text-[14px] font-semibold ${blue ? "text-white underline" : "text-[#1590D6]"}`}>Open inbox</button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {data.needs_sorting > 0 && <Tile label="Needs sorting" big={data.needs_sorting} tone="warn" blue={blue} onClick={() => navigate("/admin/requests?filter=sorting")} />}
        {data.not_contacted_red > 0 && <Tile label="Not contacted · 2 h+" big={data.not_contacted_red} tone="red" blue={blue} onClick={() => navigate("/admin/requests?filter=red")} />}
        {REQUEST_TYPES.map((t) => { const c = data.types?.[t.v] ?? { in: 0, contacted: 0, assigned: 0 };
          return <Tile key={t.v} label={t.l} big={c.in} sub={`${c.contacted} contacted · ${c.assigned} ${t.v === "admin" ? "done" : "assigned"}`} blue={blue} onClick={() => navigate(`/admin/requests?filter=${t.v}`)} />; })}
      </div>
    </section>
  );
}
function Tile({ label, big, sub, tone, blue, onClick }: { label: string; big: number; sub?: string; tone?: "warn" | "red"; blue?: boolean; onClick: () => void }) {
  const cls = tone === "red" ? "border-[#C62828] bg-[#FFEBEE] text-[#C62828]" : tone === "warn" ? "border-[#E65100] bg-[#FFF3E0] text-[#E65100]" : blue ? "border-white/25 bg-white/10 text-white hover:bg-white/20" : "";
  return (
    <button type="button" data-testid="requests-tile" onClick={onClick} className={`min-h-16 rounded-xl border-2 p-2 text-left ${cls}`}>
      <div className="text-[13px] font-semibold">{label}</div>
      <div className="text-[22px] font-semibold leading-tight">{big}</div>
      {sub && <div className={`text-[12px] ${blue && !tone ? "text-white/85" : "text-muted-foreground"}`}>{sub}</div>}
    </button>
  );
}
