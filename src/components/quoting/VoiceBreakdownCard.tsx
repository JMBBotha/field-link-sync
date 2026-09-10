/**
 * VoiceBreakdownCard — the batch confirm surface for quote-by-voice.
 *
 * Shows the parsed scene grouped by area (same names as quote_areas), fully
 * editable: qty, remove line, alternate SKU chips on ambiguous rows, copper
 * size/metres chips on incomplete rows, rename / remove area. One Confirm
 * writes everything to the live quote via the parent (QuoteContext).
 * Prices come from the catalog / Services only — nothing here invents a rand.
 */
import { Check, Loader2, Trash2, AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { PaletteProduct } from "@/components/catalog/QuoteBuilderTab";
import {
  COPPER_KIT,
  isSaveable,
  lineTotal,
  rand,
  resolveKitPending,
  sceneSubtotal,
  swapLineProduct,
  swapLineService,
  type PipeSize,
  type SceneArea,
  type SceneBreakdown,
  type SceneLine,
} from "@/lib/voiceQuoteKit";

interface Props {
  breakdown: SceneBreakdown;
  products: PaletteProduct[];
  vatRate: number;
  saving: boolean;
  hasClient: boolean;
  onChange: (next: SceneBreakdown) => void;
  onConfirm: () => void;
  onDiscard: () => void;
}

const SIZES: PipeSize[] = ["1/4", "3/8", "1/2", "5/8", "3/4"];

export default function VoiceBreakdownCard({ breakdown, products, vatRate, saving, hasClient, onChange, onConfirm, onDiscard }: Props) {
  const subtotal = sceneSubtotal(breakdown);
  const allLines = breakdown.areas.flatMap((a) => a.lines);
  const saveable = allLines.filter(isSaveable);
  const flagged = allLines.filter((l) => !isSaveable(l)).length;
  const ambiguous = allLines.filter((l) => l.status === "ambiguous").length;

  const patchArea = (key: string, fn: (a: SceneArea) => SceneArea | null) =>
    onChange({ ...breakdown, areas: breakdown.areas.map((a) => (a.key === key ? fn(a) : a)).filter((a): a is SceneArea => !!a) });

  const patchLine = (areaKey: string, lineId: string, fn: (l: SceneLine) => SceneLine | SceneLine[] | null) =>
    patchArea(areaKey, (a) => ({
      ...a,
      lines: a.lines.flatMap((l) => {
        if (l.id !== lineId) return [l];
        const r = fn(l);
        return r == null ? [] : Array.isArray(r) ? r : [r];
      }),
    }));

  const setQty = (areaKey: string, l: SceneLine, raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return;
    patchLine(areaKey, l.id, (x) => {
      // an incomplete copper row: qty is the run metres, kit builds when sizes are known
      if (x.meta.kit_pending) {
        const kp = x.meta.kit_pending as { sizes: PipeSize[]; runM: number | null };
        if (kp.sizes.length && n > 0) return resolveKitPending(x, kp.sizes, n, products);
        return { ...x, quantity: n, meta: { ...x.meta, kit_pending: { ...kp, runM: n > 0 ? n : null } }, hint: n > 0 ? `${n} m spoken — which pipe size?` : x.hint };
      }
      const status = x.status === "incomplete" && n > 0 ? "ok" : x.status;
      return { ...x, quantity: n, status, hint: status === "ok" ? undefined : x.hint };
    });
  };

  const toggleSize = (areaKey: string, l: SceneLine, sz: PipeSize) =>
    patchLine(areaKey, l.id, (x) => {
      const kp = x.meta.kit_pending as { sizes: PipeSize[]; runM: number | null };
      const sizes = kp.sizes.includes(sz) ? kp.sizes.filter((s) => s !== sz) : [...kp.sizes, sz];
      if (sizes.length && kp.runM) return resolveKitPending(x, sizes, kp.runM, products);
      return { ...x, meta: { ...x.meta, kit_pending: { ...kp, sizes } }, hint: sizes.length ? `${sizes.join(" + ")} — how many metres?` : "Pick a pipe size." };
    });

  return (
    <div className="space-y-3 rounded-md border border-border bg-background">
      {breakdown.areas.map((area) => (
        <section key={area.key} className="border-b border-border last:border-b-0">
          <header className="flex items-center gap-2 bg-muted/40 px-2 py-1.5">
            <Input
              value={area.name}
              onChange={(e) => patchArea(area.key, (a) => ({ ...a, name: e.target.value }))}
              className="h-8 max-w-xs font-medium"
              aria-label="Area name"
            />
            <span className="text-xs text-muted-foreground">{area.lines.filter(isSaveable).length} line{area.lines.filter(isSaveable).length === 1 ? "" : "s"}</span>
            {area.notes.length > 0 && <Badge variant="outline" className="text-[10px]">{area.notes.join(" · ")}</Badge>}
            <Button type="button" size="icon" variant="ghost" className="ml-auto h-7 w-7 text-destructive" aria-label={`Remove area ${area.name}`} onClick={() => patchArea(area.key, () => null)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </header>

          <ul className="divide-y divide-border text-sm">
            {area.lines.map((l) => {
              const kp = l.meta.kit_pending as { sizes: PipeSize[]; runM: number | null } | undefined;
              const bad = !isSaveable(l);
              return (
                <li key={l.id} className={cn("px-2 py-1.5", bad && "bg-amber-50/60 dark:bg-amber-950/20")}>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      inputMode="decimal"
                      step={l.unitLabel === "m" ? 0.1 : 1}
                      min={0}
                      value={l.quantity}
                      onChange={(e) => setQty(area.key, l, e.target.value)}
                      className="h-8 w-20 tabular-nums"
                      aria-label={`Quantity for ${l.label}`}
                    />
                    <span className="w-8 text-xs text-muted-foreground">{l.unitLabel}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {bad && <AlertTriangle className="mr-1 inline h-3.5 w-3.5 text-amber-600" aria-hidden />}
                      {l.label}
                      {l.product?.product_code && <span className="ml-1 text-xs text-muted-foreground">{l.product.product_code}</span>}
                      {typeof l.meta.line_note === "string" && l.meta.line_note && <span className="ml-1 text-xs text-muted-foreground">· {l.meta.line_note}</span>}
                    </span>
                    <span className="hidden tabular-nums text-muted-foreground sm:inline">{l.unitPrice ? rand(l.unitPrice) : "—"}</span>
                    <span className="w-24 text-right tabular-nums">{isSaveable(l) ? rand(lineTotal(l)) : "—"}</span>
                    <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive" aria-label={`Remove ${l.label}`} onClick={() => patchLine(area.key, l.id, () => null)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>

                  {l.hint && <p className="mt-1 pl-1 text-xs text-muted-foreground">{l.hint}</p>}

                  {kp && (
                    <div className="mt-1 flex flex-wrap gap-1 pl-1">
                      {SIZES.map((sz) => (
                        <Button key={sz} type="button" size="sm" variant={kp.sizes.includes(sz) ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => toggleSize(area.key, l, sz)}>
                          {sz}″ {COPPER_KIT[sz].spoken}
                        </Button>
                      ))}
                      <span className="self-center text-[11px] text-muted-foreground">set metres in the qty box</span>
                    </div>
                  )}

                  {l.productCandidates && l.productCandidates.length > 1 && (
                    <div className="mt-1 flex flex-wrap gap-1 pl-1">
                      {l.productCandidates.map((p) => (
                        <Button
                          key={p.id}
                          type="button"
                          size="sm"
                          variant={l.product?.id === p.id ? "default" : "outline"}
                          className="h-7 max-w-full px-2 text-xs"
                          onClick={() => patchLine(area.key, l.id, (x) => swapLineProduct(x, p))}
                          title={p.product_code}
                        >
                          <span className="truncate">{p.short_name || p.product_code}</span>
                          <span className="ml-1 opacity-70">{p.product_code}</span>
                        </Button>
                      ))}
                    </div>
                  )}

                  {l.serviceCandidates && l.serviceCandidates.length > 1 && (
                    <div className="mt-1 flex flex-wrap gap-1 pl-1">
                      {l.serviceCandidates.map((s) => (
                        <Button key={s.id} type="button" size="sm" variant={l.service?.id === s.id ? "default" : "outline"} className="h-7 px-2 text-xs" onClick={() => patchLine(area.key, l.id, (x) => swapLineService(x, s))}>
                          {s.name} · {rand(Number(s.default_price || 0))}
                        </Button>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
            {area.lines.length === 0 && <li className="px-2 py-2 text-xs text-muted-foreground">No lines in this area — it will not be created.</li>}
            {area.unparsed.length > 0 && (
              <li className="px-2 py-1.5 text-xs text-muted-foreground">Not understood: {area.unparsed.map((u) => `“${u}”`).join(", ")}</li>
            )}
          </ul>
        </section>
      ))}

      <footer className="flex flex-wrap items-center gap-2 px-2 pb-2">
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground tabular-nums">{rand(subtotal)}</span> excl. VAT · {rand(Math.round(subtotal * (1 + vatRate) * 100) / 100)} incl.
          {ambiguous > 0 && <span className="ml-2">{ambiguous} to check</span>}
          {flagged > 0 && <span className="ml-2 text-amber-700 dark:text-amber-400">{flagged} not saved (incomplete / missing)</span>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onDiscard} disabled={saving}>Discard</Button>
          <Button type="button" size="sm" onClick={onConfirm} disabled={saving || !saveable.length} className="gap-1" title={hasClient ? undefined : "Add a client first — set it above or say “client Jane Doe”."}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Confirm &amp; save {saveable.length} line{saveable.length === 1 ? "" : "s"}
          </Button>
        </div>
      </footer>
    </div>
  );
}
