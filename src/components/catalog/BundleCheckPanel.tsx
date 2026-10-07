import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, XCircle, Loader2, ListChecks, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { productMatchesTerms } from "@/lib/productSearchTags";
import { checkAllBundles, loadLiveProducts, remapBundleItem, type BundleCheckLine, type LiveProductRow } from "@/lib/bundleResolve";

type Result = Awaited<ReturnType<typeof checkAllBundles>>;

export default function BundleCheckPanel() {
  const qc = useQueryClient();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [remap, setRemap] = useState<BundleCheckLine | null>(null);
  const [live, setLive] = useState<LiveProductRow[]>([]);
  const [term, setTerm] = useState("");

  const run = async () => {
    setRunning(true);
    try {
      const r = await checkAllBundles();
      setResult(r);
      const missing = r.bundles.reduce((n, b) => n + b.lines.filter((l) => !l.found).length, 0);
      toast[missing ? "warning" : "success"](missing ? `${missing} bundle item(s) not found on the price list` : "All bundle items found");
      qc.invalidateQueries({ queryKey: ["quote-builder-bundles"] });
    } catch (e: any) {
      toast.error("Bundle check failed", { description: e?.message });
    } finally { setRunning(false); }
  };

  const openRemap = async (l: BundleCheckLine) => {
    setRemap(l); setTerm("");
    if (!live.length) setLive(await loadLiveProducts());
  };
  const matches = useMemo(() => (term.trim().length < 2 ? [] : live.filter((p) => productMatchesTerms(p as any, term)).slice(0, 30)), [live, term]);

  const choose = async (p: LiveProductRow) => {
    if (!remap) return;
    try {
      await remapBundleItem(remap.itemId, p);
      toast.success(`Remapped to ${p.short_name || p.product_code}`);
      setRemap(null);
      await run();
    } catch (e: any) { toast.error("Couldn't remap", { description: e?.message }); }
  };

  return (
    <Card className="mb-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">Bundle items are matched to the live price list by model number.</div>
        <Button size="sm" variant="outline" onClick={run} disabled={running} className="gap-1.5">
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4" />} Check bundles
        </Button>
      </div>
      {result && (
        <div className="mt-3 space-y-3">
          {result.bundles.map((b) => {
            const found = b.lines.filter((l) => l.found).length;
            return (
              <div key={b.id}>
                <div className="text-sm font-medium">{b.name} <span className="text-xs text-muted-foreground">({found}/{b.lines.length} found)</span></div>
                <ul className="mt-1 space-y-0.5">
                  {b.lines.map((l) => (
                    <li key={l.itemId} className="flex items-center gap-1.5 text-xs">
                      {l.found ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <XCircle className="h-3.5 w-3.5 text-destructive" />}
                      <span className={l.found ? "" : "text-destructive"}>{l.text}{l.status === "remapped" ? " (remapped)" : ""}</span>
                      {!l.found && <Button size="sm" variant="link" className="h-auto p-0 text-xs" onClick={() => openRemap(l)}>Remap</Button>}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
      <Dialog open={!!remap} onOpenChange={(o) => !o && setRemap(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Remap {remap?.model}</DialogTitle></DialogHeader>
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input autoFocus className="pl-8" placeholder="Search code, name, size or tags" value={term} onChange={(e) => setTerm(e.target.value)} />
          </div>
          <div className="max-h-80 overflow-y-auto divide-y">
            {!live.length && <div className="p-3 text-sm text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin" /> Loading price list…</div>}
            {matches.map((p) => (
              <button key={p.id} type="button" onClick={() => choose(p)} className="block w-full px-2 py-2 text-left text-sm hover:bg-muted">
                {p.short_name || p.description} <span className="text-xs text-muted-foreground">{p.product_code} · {p.suppliers?.name ?? ""}</span>
              </button>
            ))}
            {live.length > 0 && term.trim().length >= 2 && !matches.length && <div className="p-3 text-sm text-muted-foreground">No matches.</div>}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
