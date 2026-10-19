import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRole } from "@/hooks/useRole";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Online shop models (Johan 2026-10-19): which catalogue unit the 0800-BE-COOL website shop sells for each room
 * size and option. Prices come live from the catalogue (incl VAT shown here); the website never sees costs.
 * Admin only; the server (fl_shop_tier_map_set) checks the company admin role again.
 */
export const SHOP_SIZES = [
  { btu: 9000, label: "Small", m2: "up to 15 m²" },
  { btu: 12000, label: "Medium", m2: "16–24 m²" },
  { btu: 18000, label: "Large", m2: "25–35 m²" },
  { btu: 24000, label: "X-Large", m2: "36–48 m²" },
] as const;
export const SHOP_TIERS = [
  { tier: "entry", label: "Entry" },
  { tier: "inverter", label: "Best seller" },
  { tier: "windfree", label: "Premium" },
] as const;
export const SHOP_OTHER_TIERS = [
  { tier: "other_budget", label: "Other: lower price" },
  { tier: "other_allergy", label: "Other: allergies / air purifying" },
] as const;

type Row = { btu: number; tier: string; product_id: string; code: string; name: string; sell_incl: number | null };
type Cand = { product_id: string; btu: number; code: string; name: string; description: string | null; sell_incl: number | null };

const rand = (n: number | null | undefined) =>
  n == null ? "" : `R${Math.round(Number(n)).toLocaleString("en-ZA").replace(/,/g, " ")}`;

export default function ShopModelsCard() {
  const { user } = useAuth();
  const { isAdmin } = useRole();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showOther, setShowOther] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ["shop-tier-map", user?.id],
    enabled: !!user?.id && !!isAdmin,
    queryFn: async () => {
      const { data: p } = await (supabase.from("profiles") as any).select("company_id").eq("id", user!.id).maybeSingle();
      if (!p?.company_id) return null;
      const { data: res, error } = await (supabase.rpc as any)("fl_shop_tier_map_admin", { p_company: p.company_id });
      if (error) return null; // not an admin of this company, or the shop isn't set up: show nothing
      return { companyId: p.company_id as string, rows: (res?.rows ?? []) as Row[], candidates: (res?.candidates ?? []) as Cand[] };
    },
  });
  if (!isAdmin || !data) return null;

  const current = (btu: number, tier: string) => data.rows.find((r) => r.btu === btu && r.tier === tier);
  const save = async (btu: number, tier: string, productId: string) => {
    const key = `${btu}-${tier}`;
    setSaving(key);
    const { error } = await (supabase.rpc as any)("fl_shop_tier_map_set", {
      p_company: data.companyId, p_btu: btu, p_tier: tier, p_product: productId || null,
    });
    setSaving(null);
    if (error) { toast({ title: "Couldn't save", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Shop model saved", description: "The website shop uses it straight away." });
    qc.invalidateQueries({ queryKey: ["shop-tier-map"] });
  };
  const picker = (btu: number, tier: string, allowNone: boolean) => {
    const cur = current(btu, tier);
    const options = data.candidates.filter((c) => c.btu === btu);
    return (
      <select
        aria-label={`${btu} BTU ${tier}`}
        data-testid={`shop-pick-${btu}-${tier}`}
        className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        value={cur?.product_id ?? ""}
        disabled={saving === `${btu}-${tier}`}
        onChange={(e) => save(btu, tier, e.target.value)}
      >
        {(allowNone || !cur) && <option value="">{allowNone ? "Not offered" : "Choose a unit"}</option>}
        {cur && !options.some((o) => o.product_id === cur.product_id) && (
          <option value={cur.product_id}>{cur.code} · {cur.name} {rand(cur.sell_incl)}</option>
        )}
        {options.map((o) => (
          <option key={o.product_id} value={o.product_id}>
            {o.code} · {(o.description || o.name || "").split(" - ")[0]} · {rand(o.sell_incl)}
          </option>
        ))}
      </select>
    );
  };
  const tiers = showOther ? [...SHOP_TIERS, ...SHOP_OTHER_TIERS] : SHOP_TIERS;

  return (
    <Card data-testid="shop-models-card">
      <CardHeader>
        <CardTitle>Online shop models</CardTitle>
        <p className="text-sm text-muted-foreground">
          The unit the website shop sells for each room size. Prices are the live catalogue sell prices (incl VAT) plus the fixed installation price. The website never sees costs or markup.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {SHOP_SIZES.map((s) => (
          <div key={s.btu} className="rounded-lg border p-3">
            <div className="mb-2 text-sm font-semibold">{s.label} <span className="font-normal text-muted-foreground">· {s.m2} · {s.btu / 1000}K BTU</span></div>
            <div className="grid gap-2 md:grid-cols-3">
              {tiers.map((t) => (
                <label key={t.tier} className="block text-xs text-muted-foreground">
                  {t.label}
                  {picker(s.btu, t.tier, t.tier.startsWith("other_"))}
                </label>
              ))}
            </div>
          </div>
        ))}
        <button type="button" className="text-sm text-primary underline" onClick={() => setShowOther((v) => !v)}>
          {showOther ? "Hide other needs" : "Show other needs (lower price, allergies)"}
        </button>
      </CardContent>
    </Card>
  );
}
