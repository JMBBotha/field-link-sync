import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { addKeyword, topCorrections, typeLabel } from "@/lib/requests";

/** Admin only (RPC returns [] for others): words that keep getting re-sorted by hand. One tap teaches the sorter. */
export default function RequestCorrectionsPanel() {
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ["requests-corrections"], queryFn: () => topCorrections(7) });
  if (!data.length) return null;
  return (
    <section className="rounded-2xl border bg-card p-3" data-testid="request-corrections">
      <h3 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Sorting fixes this week</h3>
      <ul className="mt-2 flex flex-wrap gap-2">
        {data.slice(0, 8).map((c) => (
          <li key={`${c.word}-${c.type}`}>
            <button className="min-h-11 rounded-xl border px-3 text-[14px]" onClick={async () => {
              const r = await addKeyword(c.type, c.word);
              if (r.ok) { toast.success(`"${c.word}" now sorts as ${typeLabel(c.type)}`); qc.invalidateQueries({ queryKey: ["requests-corrections"] }); } else toast.error(r.message || "Could not save");
            }}>"{c.word}" → {typeLabel(c.type)} <span className="opacity-60">×{c.n}</span></button>
          </li>
        ))}
      </ul>
    </section>
  );
}
