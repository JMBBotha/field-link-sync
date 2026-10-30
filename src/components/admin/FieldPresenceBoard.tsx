import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { sastTime } from "@/lib/techLocation";

type Row = { id: string; kind: string; name: string; title: string | null; en_route_at: string | null; arrived_at: string | null; left_at: string | null; arrived_source: string | null; distance_m: number | null };

/** Admin home: today's live field status (techs on jobs + sales visits). Server returns [] for non-admins. */
export default function FieldPresenceBoard() {
  const q = useQuery({
    queryKey: ["presence-board"],
    refetchInterval: 60_000,
    queryFn: async () => ((await (supabase.rpc as any)("presence_board")).data || []) as Row[],
  });
  const rows = q.data || [];
  if (!rows.length) return null;
  return (
    <section className="v7-solid space-y-2 rounded-2xl border bg-card p-3" data-testid="presence-board">
      <h2 className="text-base font-semibold">Live field status</h2>
      {rows.map((r) => (
        <div key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
          <span className="min-w-0"><span className="font-medium">{r.name}</span> <span className="text-muted-foreground">· {r.kind === "job" ? "Job" : "Sales visit"} · {r.title}</span></span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {r.left_at ? `Left ${sastTime(r.left_at)}` : r.arrived_at ? `On site since ${sastTime(r.arrived_at)}${r.arrived_source === "manual" ? " (manual)" : ""}` : r.en_route_at ? `On the way${r.distance_m != null ? ` · ${(r.distance_m / 1000).toFixed(1)} km` : ""}` : "Not started"}
          </span>
        </div>
      ))}
    </section>
  );
}
