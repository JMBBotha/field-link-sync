import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Eye, EyeOff } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface SupplierOption {
  id: string;
  name: string;
}

interface PageRow {
  page_number: number;
  page_image_url: string | null;
}

interface RegionRow {
  id: string;
  product_code: string;
  short_name: string | null;
  page_number: number | null;
  row_bbox: any;
  price_bbox: any;
}

interface NormalizedRegion {
  id: string;
  code: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  raw: any;
  valid: boolean;
}

const COLORS = [
  "hsl(0 84% 60%)", "hsl(24 95% 53%)", "hsl(45 93% 47%)",
  "hsl(142 71% 45%)", "hsl(199 89% 48%)", "hsl(262 83% 58%)",
  "hsl(330 81% 60%)",
];

const normalizeBbox = (rb: any): { x: number; y: number; w: number; h: number; valid: boolean } => {
  if (!rb || typeof rb !== "object") return { x: 0, y: 0, w: 0, h: 0, valid: false };
  const x = Number(rb.x ?? rb.x_pct ?? 0);
  const y = Number(rb.y ?? rb.y_pct ?? 0);
  const w = Number(rb.width ?? rb.w ?? rb.w_pct ?? 0);
  const h = Number(rb.height ?? rb.h ?? rb.h_pct ?? 0);
  const allFinite = [x, y, w, h].every((v) => Number.isFinite(v));
  const inRange = allFinite && x >= 0 && x <= 1 && y >= 0 && y <= 1 && w > 0 && w <= 1 && h > 0 && h <= 1;
  return { x, y, w, h, valid: inRange };
};

const AdminOverlayDebugPage = () => {
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [supplierId, setSupplierId] = useState<string>("");
  const [supplierName, setSupplierName] = useState<string>("");
  const [pages, setPages] = useState<PageRow[]>([]);
  const [pageNumber, setPageNumber] = useState<number | null>(null);
  const [pageImageUrl, setPageImageUrl] = useState<string | null>(null);
  const [regions, setRegions] = useState<RegionRow[]>([]);
  const [loadingPages, setLoadingPages] = useState(false);
  const [loadingRegions, setLoadingRegions] = useState(false);
  const [showInvalid, setShowInvalid] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [filterCode, setFilterCode] = useState("");

  // Load suppliers list
  useEffect(() => {
    (async () => {
      const { data, error } = await (supabase.from("suppliers") as any)
        .select("id, name")
        .order("name");
      if (error) {
        toast({ title: "Failed to load suppliers", description: error.message, variant: "destructive" });
        return;
      }
      setSuppliers((data || []) as SupplierOption[]);
    })();
  }, []);

  // When supplier changes, load pages
  useEffect(() => {
    if (!supplierId) {
      setPages([]);
      setPageNumber(null);
      setPageImageUrl(null);
      setRegions([]);
      return;
    }
    const supplier = suppliers.find((s) => s.id === supplierId);
    setSupplierName(supplier?.name || "");

    (async () => {
      setLoadingPages(true);
      // supplier_pdf_pages.supplier_id is text — use either id or name
      const { data, error } = await (supabase.from("supplier_pdf_pages") as any)
        .select("page_number, page_image_url")
        .or(`supplier_id.eq.${supplierId},supplier_id.eq.${supplier?.name}`)
        .order("page_number");
      setLoadingPages(false);
      if (error) {
        toast({ title: "Failed to load pages", description: error.message, variant: "destructive" });
        return;
      }
      // de-dupe by page_number
      const seen = new Set<number>();
      const unique: PageRow[] = [];
      for (const r of (data || []) as PageRow[]) {
        if (r.page_number == null || seen.has(r.page_number)) continue;
        seen.add(r.page_number);
        unique.push(r);
      }
      setPages(unique);
    })();
  }, [supplierId, suppliers]);

  // When page changes, load regions
  useEffect(() => {
    if (!supplierId || pageNumber == null) {
      setRegions([]);
      setPageImageUrl(null);
      return;
    }
    const pageRow = pages.find((p) => p.page_number === pageNumber);
    setPageImageUrl(pageRow?.page_image_url || null);

    (async () => {
      setLoadingRegions(true);
      const { data, error } = await (supabase.from("supplier_products") as any)
        .select("id, product_code, short_name, page_number, row_bbox, price_bbox")
        .eq("supplier_id", supplierId)
        .eq("page_number", pageNumber);
      setLoadingRegions(false);
      if (error) {
        toast({ title: "Failed to load regions", description: error.message, variant: "destructive" });
        return;
      }
      setRegions((data || []) as RegionRow[]);
    })();
  }, [supplierId, pageNumber, pages]);

  const normalized = useMemo<NormalizedRegion[]>(() => {
    const filter = filterCode.trim().toLowerCase();
    return regions
      .map((r, idx) => {
        const n = normalizeBbox(r.row_bbox);
        return {
          id: r.id,
          code: r.product_code || "(no code)",
          name: r.short_name || "",
          x: n.x,
          y: n.y,
          w: n.w,
          h: n.h,
          raw: r.row_bbox,
          valid: n.valid,
        };
      })
      .filter((r) => (showInvalid ? true : r.valid))
      .filter((r) => (filter ? r.code.toLowerCase().includes(filter) : true));
  }, [regions, showInvalid, filterCode]);

  const stats = useMemo(() => {
    const total = regions.length;
    const withBbox = regions.filter((r) => r.row_bbox).length;
    const validBbox = regions.filter((r) => normalizeBbox(r.row_bbox).valid).length;
    return { total, withBbox, validBbox };
  }, [regions]);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Overlay Debug View</h1>
        <p className="text-sm text-muted-foreground">
          Renders only stored <code className="bg-muted px-1 rounded">row_bbox</code> regions over the raw PDF page image.
          Use this to visually verify whether stored coordinates land where you expect.
        </p>
      </div>

      <Card className="p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label>Supplier</Label>
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
              <SelectContent>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Page</Label>
            <Select
              value={pageNumber != null ? String(pageNumber) : ""}
              onValueChange={(v) => setPageNumber(Number(v))}
              disabled={!supplierId || loadingPages}
            >
              <SelectTrigger>
                <SelectValue placeholder={loadingPages ? "Loading…" : "Select page"} />
              </SelectTrigger>
              <SelectContent>
                {pages.map((p) => (
                  <SelectItem key={p.page_number} value={String(p.page_number)}>
                    Page {p.page_number} {p.page_image_url ? "" : "(no image)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Filter by product code</Label>
            <Input
              value={filterCode}
              onChange={(e) => setFilterCode(e.target.value)}
              placeholder="e.g. FTXM35"
            />
          </div>

          <div className="space-y-1">
            <Label>Toggles</Label>
            <div className="flex gap-2">
              <Button
                variant={showLabels ? "default" : "outline"}
                size="sm"
                onClick={() => setShowLabels((s) => !s)}
              >
                {showLabels ? <Eye className="h-3.5 w-3.5 mr-1" /> : <EyeOff className="h-3.5 w-3.5 mr-1" />}
                Labels
              </Button>
              <Button
                variant={showInvalid ? "default" : "outline"}
                size="sm"
                onClick={() => setShowInvalid((s) => !s)}
              >
                Invalid
              </Button>
            </div>
          </div>
        </div>

        {supplierId && (
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="secondary">Supplier: {supplierName}</Badge>
            <Badge variant="secondary">Pages with image: {pages.filter((p) => p.page_image_url).length}/{pages.length}</Badge>
            {pageNumber != null && (
              <>
                <Badge variant="secondary">Products on page: {stats.total}</Badge>
                <Badge variant={stats.withBbox === stats.total ? "default" : "destructive"}>
                  With row_bbox: {stats.withBbox}/{stats.total}
                </Badge>
                <Badge variant={stats.validBbox === stats.withBbox ? "default" : "destructive"}>
                  Valid normalized: {stats.validBbox}/{stats.withBbox}
                </Badge>
                <Badge variant="outline">Showing: {normalized.length}</Badge>
              </>
            )}
          </div>
        )}
      </Card>

      <Card className="p-4">
        {!supplierId || pageNumber == null ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            Pick a supplier and page to begin.
          </div>
        ) : loadingRegions ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading regions…
          </div>
        ) : !pageImageUrl ? (
          <div className="text-center py-12 text-destructive text-sm">
            No <code className="bg-muted px-1 rounded">page_image_url</code> stored for this page — cannot render background.
            {normalized.length > 0 && (
              <div className="mt-3 text-muted-foreground">
                {normalized.length} region(s) exist for this page; switch to a page that has a stored image.
              </div>
            )}
          </div>
        ) : (
          <div className="relative inline-block w-full">
            <img
              src={pageImageUrl}
              alt={`Page ${pageNumber}`}
              className="w-full h-auto block border rounded"
              draggable={false}
            />
            <div className="absolute inset-0 pointer-events-none">
              {normalized.map((r, idx) => {
                const color = COLORS[idx % COLORS.length];
                const left = `${(r.x * 100).toFixed(3)}%`;
                const top = `${(r.y * 100).toFixed(3)}%`;
                const width = `${(r.w * 100).toFixed(3)}%`;
                const height = `${(r.h * 100).toFixed(3)}%`;
                return (
                  <div key={r.id}>
                    <div
                      className="absolute border-2"
                      style={{
                        left, top, width, height,
                        borderColor: r.valid ? color : "hsl(var(--destructive))",
                        background: r.valid ? `${color.replace("hsl", "hsla").replace(")", " / 0.12)")}` : "hsl(var(--destructive) / 0.15)",
                        borderStyle: r.valid ? "solid" : "dashed",
                      }}
                    />
                    {showLabels && (
                      <div
                        className="absolute text-[10px] font-mono px-1 rounded shadow-sm whitespace-nowrap"
                        style={{
                          left, top,
                          transform: "translateY(-100%)",
                          background: r.valid ? color : "hsl(var(--destructive))",
                          color: "white",
                        }}
                      >
                        {r.code}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      {pageNumber != null && normalized.length > 0 && (
        <Card className="p-4">
          <div className="text-xs font-semibold mb-2">Region details</div>
          <div className="overflow-auto max-h-72">
            <table className="w-full text-xs">
              <thead className="bg-muted text-left">
                <tr>
                  <th className="p-1.5">#</th>
                  <th className="p-1.5">Code</th>
                  <th className="p-1.5">Name</th>
                  <th className="p-1.5">x</th>
                  <th className="p-1.5">y</th>
                  <th className="p-1.5">w</th>
                  <th className="p-1.5">h</th>
                  <th className="p-1.5">Valid</th>
                </tr>
              </thead>
              <tbody>
                {normalized.map((r, idx) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-1.5">
                      <span
                        className="inline-block w-3 h-3 rounded-sm mr-1 align-middle"
                        style={{ background: r.valid ? COLORS[idx % COLORS.length] : "hsl(var(--destructive))" }}
                      />
                      {idx + 1}
                    </td>
                    <td className="p-1.5 font-mono">{r.code}</td>
                    <td className="p-1.5 truncate max-w-[200px]">{r.name}</td>
                    <td className="p-1.5 font-mono">{r.x.toFixed(3)}</td>
                    <td className="p-1.5 font-mono">{r.y.toFixed(3)}</td>
                    <td className="p-1.5 font-mono">{r.w.toFixed(3)}</td>
                    <td className="p-1.5 font-mono">{r.h.toFixed(3)}</td>
                    <td className="p-1.5">{r.valid ? "✓" : "✗"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
};

export default AdminOverlayDebugPage;
