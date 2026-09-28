import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useCanWriteMasterCatalog } from "@/components/catalog/MasterCatalogGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { CatalogService } from "@/lib/catalogServices";

/** Master admins only: core services, every company's custom services, per-company limits. */
export default function ServicesCatalogCard() {
  const { user } = useAuth();
  const { canWrite } = useCanWriteMasterCatalog();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["services-catalog-admin"],
    enabled: canWrite,
    queryFn: async () => {
      const [s, c, m] = await Promise.all([
        (supabase.from("catalog_services") as any).select("id, name, description, sort_order, origin, owner_company_id, is_active").order("sort_order", { nullsFirst: false }),
        (supabase.from("companies") as any).select("id, name, is_master, custom_service_limit"),
        (supabase.from("company_network_members") as any).select("member_company_id"),
      ]);
      if (s.error) throw s.error;
      return { services: (s.data || []) as CatalogService[], companies: (c.data || []) as any[], memberIds: new Set<string>((m.data || []).map((r: any) => r.member_company_id)) };
    },
  });
  if (!canWrite || !data) return null;
  const master = data.companies.find((c) => c.is_master);
  const nameOf = (id: string) => data.companies.find((c) => c.id === id)?.name ?? "Unknown company";
  const refresh = () => { qc.invalidateQueries({ queryKey: ["services-catalog-admin"] }); qc.invalidateQueries({ queryKey: ["catalog-services"] }); };
  const run = async (p: PromiseLike<{ error: any }>) => {
    const { error } = await p;
    if (error) toast({ title: "Couldn't save", description: error.message, variant: "destructive" });
    refresh();
  };
  const patch = (id: string, v: Record<string, unknown>) => run((supabase.from("catalog_services") as any).update(v).eq("id", id));
  const core = data.services.filter((s) => s.origin === "core" && s.is_active);
  const custom = data.services.filter((s) => s.origin === "custom" && s.is_active);
  const archived = data.services.filter((s) => !s.is_active);
  const nextOrder = Math.max(0, ...core.map((s) => s.sort_order ?? 0)) + 1;

  return (
    <Card>
      <CardHeader><CardTitle>Services</CardTitle></CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="space-y-2">
          {core.map((s) => (
            <div key={s.id} className="grid grid-cols-[3.5rem_1fr_auto] gap-2 sm:grid-cols-[3.5rem_1fr_1fr_auto]">
              <Input type="number" className="h-8" defaultValue={s.sort_order ?? ""} aria-label="Order"
                onBlur={(e) => { const n = parseInt(e.target.value); if (Number.isFinite(n) && n !== s.sort_order) void patch(s.id, { sort_order: n }); }} />
              <Input className="h-8" defaultValue={s.name} maxLength={120} aria-label="Name"
                onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== s.name) void patch(s.id, { name: v }); }} />
              <Input className="col-span-2 h-8 sm:col-span-1 order-last sm:order-none" defaultValue={s.description ?? ""} maxLength={1000} aria-label="Description"
                onBlur={(e) => { if (e.target.value !== (s.description ?? "")) void patch(s.id, { description: e.target.value || null }); }} />
              <Button size="sm" variant="ghost" className="h-8" onClick={() => void patch(s.id, { is_active: false })}>Archive</Button>
            </div>
          ))}
        </div>

        <div className="space-y-2 border-t border-border pt-3">
          <p className="font-medium">Custom services from companies</p>
          {custom.length === 0 && <p className="text-muted-foreground">None yet.</p>}
          {custom.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate">{s.name} <span className="text-xs text-muted-foreground">· {nameOf(s.owner_company_id)}</span></span>
              <Button size="sm" variant="outline" disabled={!master}
                onClick={() => void patch(s.id, { origin: "core", owner_company_id: master.id, promoted_at: new Date().toISOString(), promoted_by: user?.id, sort_order: nextOrder })}>
                Promote to core
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void patch(s.id, { is_active: false })}>Remove</Button>
            </div>
          ))}
        </div>

        {archived.length > 0 && (
          <div className="space-y-2 border-t border-border pt-3">
            <p className="font-medium">Archived</p>
            {archived.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{s.name}{s.origin === "custom" ? ` · ${nameOf(s.owner_company_id)}` : ""}</span>
                <Button size="sm" variant="outline" onClick={() => void patch(s.id, { is_active: true })}>Restore</Button>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2 border-t border-border pt-3">
          <p className="font-medium">Custom service limit per company</p>
          {data.companies.filter((c) => data.memberIds.has(c.id)).map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2">
              <span className="truncate">{c.name}</span>
              <Input type="number" min="0" className="h-8 w-20" defaultValue={c.custom_service_limit ?? 5} aria-label={`Custom limit for ${c.name}`}
                onBlur={(e) => { const n = parseInt(e.target.value); if (Number.isFinite(n) && n >= 0 && n !== c.custom_service_limit) void run((supabase.from("companies") as any).update({ custom_service_limit: n }).eq("id", c.id)); }} />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
