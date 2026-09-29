import { Loader2, Star, Wrench, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getEffectiveUnitPrices, type PaletteProduct } from "@/components/catalog/QuoteBuilderTab";
import type { CatalogService } from "@/lib/catalogServices";
import { groupFavourites, useQuoteFavourites } from "@/hooks/useQuoteFavourites";

const money = (n: number) =>
  `R ${Number(n || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Phone favourites list. Display only — never writes; the parent's add path does. */
export default function FavouritesPicker({
  products, services, onPickProduct, onPickService, busyId, onClose,
}: {
  products: PaletteProduct[];
  services: CatalogService[];
  onPickProduct: (p: PaletteProduct) => Promise<void> | void;
  onPickService?: (s: CatalogService) => Promise<void> | void;
  busyId?: string | null;
  onClose?: () => void;
}) {
  const { ids, loading } = useQuoteFavourites();
  const g = groupFavourites(ids, products, onPickService ? services : []);
  const empty = g.units.length === 0 && g.materials.length === 0;

  const productRow = (p: PaletteProduct) => (
    <button
      key={p.id}
      type="button"
      disabled={busyId === p.id}
      onClick={() => void onPickProduct(p)}
      className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted"
    >
      <Star className="h-4 w-4 shrink-0 fill-amber-400 text-amber-400" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{p.short_name || p.product_code}</span>
        <span className="block truncate text-xs text-muted-foreground">{p.brand}</span>
      </span>
      {busyId === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : (
        <span className="shrink-0 text-xs font-medium">{money(getEffectiveUnitPrices(p).unitSell)}</span>
      )}
    </button>
  );

  const header = (t: string) => (
    <p className="bg-muted/50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t}</p>
  );

  return (
    <div data-testid="favourites-picker" data-pdf-hide className="rounded-md border bg-background print:hidden">
      {onClose && (
        <div className="flex items-center justify-between px-3 py-1">
          <span className="text-sm font-medium">★ Favourites</span>
          <Button type="button" size="icon" variant="ghost" className="h-9 w-9" aria-label="Close" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
      )}
      {loading ? (
        <div className="flex justify-center p-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : (
        <div className="max-h-[60vh] divide-y overflow-y-auto">
          {empty && <p className="px-3 py-3 text-sm text-muted-foreground">No favourites yet. Star products in the PDF viewer.</p>}
          {g.units.length > 0 && <>{header("Units")}{g.units.map(productRow)}</>}
          {g.materials.length > 0 && <>{header("Materials")}{g.materials.map(productRow)}</>}
          {onPickService && g.services.length > 0 && <>
            {header("Services")}
            {g.services.map((s) => (
              <button key={s.id} type="button" disabled={busyId === s.id} onClick={() => void onPickService(s)}
                className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted">
                <Wrench className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm">{s.name}</span>
                {busyId === s.id && <Loader2 className="h-4 w-4 animate-spin" />}
              </button>
            ))}
          </>}
          {g.hiddenCount > 0 && <p className="px-3 py-2 text-xs text-muted-foreground">{g.hiddenCount} archived favourite(s) hidden</p>}
        </div>
      )}
    </div>
  );
}
