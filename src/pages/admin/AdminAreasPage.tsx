import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, addDays } from "date-fns";
import { toast } from "sonner";
import { MapPin, Trash2, Route, CalendarClock, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { geocodeAddress } from "@/lib/geocodeAddress";
import { routeLead, areaSlots, describeRoute, hhmm, type ServiceArea, type RouteResult, type SlotStaff } from "@/lib/serviceAreas";

/** P6: service areas (who covers where), lead routing suggestions and area-based slotting. Nothing here messages anyone. */
const AdminAreasPage = () => {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["service-areas"],
    queryFn: async () => {
      const [a, s, p, m] = await Promise.all([
        (supabase.from("service_areas" as any) as any).select("*").order("priority", { ascending: false }).order("name"),
        (supabase.from("service_area_staff" as any) as any).select("area_id, profile_id"),
        supabase.from("profiles").select("id, full_name, company_id, dispatch_role").not("company_id", "is", null).is("archived_at", null).order("full_name"),
        (supabase.from("companies") as any).select("id, is_master").eq("is_master", true),
      ]);
      return { areas: (a.data || []) as ServiceArea[], staff: (s.data || []) as { area_id: string; profile_id: string }[], people: (p.data || []) as any[], isMaster: (m.data || []).length > 0 };
    },
  });
  const { data: leads } = useQuery({
    queryKey: ["areas-pending-leads"],
    queryFn: async () => (await supabase.from("leads").select("id, customer_name, customer_address, created_at, latitude").eq("status", "pending").is("assigned_agent_id", null).order("created_at", { ascending: false }).limit(15)).data || [],
  });
  const { data: log } = useQuery({
    queryKey: ["routing-log"],
    queryFn: async () => ((await (supabase.from("lead_routing_log" as any) as any).select("id, lead_id, mode, reason, km, created_at").order("created_at", { ascending: false }).limit(15)).data || []) as any[],
  });

  const [form, setForm] = useState({ name: "", address: "", lat: "", lng: "", radius: "25", priority: "0" });
  const [busy, setBusy] = useState(false);
  const [routes, setRoutes] = useState<Record<string, RouteResult | string>>({});
  const [slots, setSlots] = useState<Record<string, SlotStaff[] | string>>({});
  const slotDate = format(addDays(new Date(), 1), "yyyy-MM-dd");
  const refresh = () => { qc.invalidateQueries({ queryKey: ["service-areas"] }); qc.invalidateQueries({ queryKey: ["routing-log"] }); };

  const findAddress = async () => {
    const g = await geocodeAddress(form.address);
    if (!g) return toast.error("Address not found – enter latitude/longitude instead");
    setForm((f) => ({ ...f, lat: g.latitude.toFixed(5), lng: g.longitude.toFixed(5) }));
  };
  const addArea = async () => {
    const lat = Number(form.lat), lng = Number(form.lng), radius = Number(form.radius);
    if (!form.name.trim() || !Number.isFinite(lat) || !Number.isFinite(lng) || !form.lat || !form.lng) return toast.error("Name and a location are required");
    setBusy(true);
    const { error } = await (supabase.from("service_areas" as any) as any).insert({ name: form.name.trim(), center_lat: lat, center_lng: lng, radius_km: radius || 25, priority: Number(form.priority) || 0 });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Area added"); setForm({ name: "", address: "", lat: "", lng: "", radius: "25", priority: "0" }); refresh();
  };
  const patchArea = async (id: string, patch: Partial<ServiceArea>) => {
    const { error } = await (supabase.from("service_areas" as any) as any).update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) toast.error(error.message); refresh();
  };
  const removeArea = async (id: string) => {
    if (!confirm("Remove this area?")) return;
    const { error } = await (supabase.from("service_areas" as any) as any).delete().eq("id", id);
    if (error) toast.error(error.message); refresh();
  };
  const toggleStaff = async (areaId: string, profileId: string, on: boolean) => {
    const t = supabase.from("service_area_staff" as any) as any;
    const { error } = on ? await t.insert({ area_id: areaId, profile_id: profileId }) : await t.delete().eq("area_id", areaId).eq("profile_id", profileId);
    if (error) toast.error(error.message); refresh();
  };
  const suggest = async (leadId: string, apply = false) => {
    try { const r = await routeLead(leadId, apply); setRoutes((m) => ({ ...m, [leadId]: r })); if (apply && r.mode === "applied") { toast.success(describeRoute(r)); qc.invalidateQueries({ queryKey: ["areas-pending-leads"] }); } refresh(); }
    catch (e: any) { setRoutes((m) => ({ ...m, [leadId]: e.message })); }
  };
  const showSlots = async (leadId: string) => {
    try { const r = await areaSlots(leadId, slotDate); setSlots((m) => ({ ...m, [leadId]: r.staff.length ? r.staff : (r.reason || (r.areas.length ? "No staff linked to this area" : "None of your areas cover this lead")) })); }
    catch (e: any) { setSlots((m) => ({ ...m, [leadId]: e.message })); }
  };

  if (isLoading || !data) return <div className="p-6 text-muted-foreground flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading areas…</div>;
  const staffOf = (areaId: string) => new Set(data.staff.filter((s) => s.area_id === areaId).map((s) => s.profile_id));

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2"><MapPin className="h-5 w-5" /> Service areas</h1>
        <p className="text-sm text-muted-foreground">Where your company works and who covers each area. Used to suggest which company and which people fit a new lead. Customers are never contacted from here.</p>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">Add an area</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-6">
          <div className="md:col-span-2 space-y-1"><Label htmlFor="area-name">Name</Label><Input id="area-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Northern suburbs" /></div>
          <div className="md:col-span-4 space-y-1"><Label htmlFor="area-addr">Centre address</Label>
            <div className="flex gap-2"><Input id="area-addr" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Suburb or street" /><Button variant="outline" type="button" onClick={findAddress}>Find</Button></div></div>
          <div className="space-y-1"><Label htmlFor="area-lat">Latitude</Label><Input id="area-lat" inputMode="decimal" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="area-lng">Longitude</Label><Input id="area-lng" inputMode="decimal" value={form.lng} onChange={(e) => setForm({ ...form, lng: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="area-r">Radius (km)</Label><Input id="area-r" inputMode="numeric" value={form.radius} onChange={(e) => setForm({ ...form, radius: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="area-p">Priority</Label><Input id="area-p" inputMode="numeric" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} /></div>
          <div className="md:col-span-2 flex items-end"><Button className="w-full" onClick={addArea} disabled={busy}>{busy ? "Adding…" : "Add area"}</Button></div>
        </CardContent>
      </Card>

      {data.areas.length === 0 && <p className="text-sm text-muted-foreground">No areas yet.</p>}
      {data.areas.map((a) => {
        const on = staffOf(a.id);
        return (
          <Card key={a.id} data-testid="area-card">
            <CardContent className="pt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{a.name}</span>
                <Badge variant="secondary">{Number(a.radius_km)} km</Badge>
                {a.priority ? <Badge variant="outline">priority {a.priority}</Badge> : null}
                <div className="ml-auto flex items-center gap-2 text-sm">
                  <Switch data-no-min="" className="shrink-0" checked={a.active} onCheckedChange={(v) => patchArea(a.id, { active: v })} aria-label="Active" /> {a.active ? "Active" : "Paused"}
                  <Button size="icon" variant="ghost" onClick={() => removeArea(a.id)} aria-label="Remove area"><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {data.people.filter((p) => p.company_id === a.company_id).map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm min-h-[44px] md:min-h-0"><Checkbox data-no-min="" className="shrink-0" checked={on.has(p.id)} onCheckedChange={(v) => toggleStaff(a.id, p.id, !!v)} />{p.full_name || "Unnamed"}</label>
                ))}
              </div>
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Route className="h-4 w-4" /> New leads – who covers them?</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {(leads || []).length === 0 && <p className="text-sm text-muted-foreground">No unclaimed leads.</p>}
          {(leads || []).map((l: any) => {
            const r = routes[l.id]; const s = slots[l.id];
            return (
              <div key={l.id} className="rounded-md border p-3 space-y-2" data-testid="route-lead">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0"><div className="font-medium truncate">{l.customer_name || "Lead"}</div><div className="text-xs text-muted-foreground truncate">{l.customer_address}</div></div>
                  <div className="ml-auto flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => suggest(l.id)}>Suggest</Button>
                    <Button size="sm" variant="outline" onClick={() => showSlots(l.id)}><CalendarClock className="h-4 w-4 mr-1" />Who fits {format(addDays(new Date(), 1), "EEE d MMM")}</Button>
                  </div>
                </div>
                {r && <div className="text-sm">{typeof r === "string" ? <span className="text-destructive">{r}</span> : describeRoute(r)}
                  {typeof r !== "string" && r.mode === "suggest" && !r.same_company && data.isMaster && (
                    <Button size="sm" className="ml-2" onClick={() => confirm(`Move this lead to ${r.company}? Nobody is notified.`) && suggest(l.id, true)}>Move to {r.company}</Button>)}
                </div>}
                {s && (typeof s === "string" ? <div className="text-sm text-muted-foreground">{s}</div> : (
                  <ul className="text-sm space-y-1">{s.map((x) => (
                    <li key={x.profile_id} className="flex gap-2"><span className={x.fits ? "text-emerald-600" : "text-muted-foreground"}>{x.fits ? "✓" : "–"}</span><span>{x.name}</span>
                      <span className="text-muted-foreground">{x.fits ? `from ${hhmm(x.best_start)}${x.km != null ? ` · ${x.km} km` : ""}${x.label ? ` · ${x.label}` : ""}` : x.reason}</span></li>))}</ul>))}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {(log || []).length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Routing log</CardTitle></CardHeader>
          <CardContent><ul className="text-sm space-y-1">{(log || []).map((g) => (
            <li key={g.id} className="flex gap-2"><span className="text-muted-foreground w-28 shrink-0">{format(new Date(g.created_at), "d MMM HH:mm")}</span><Badge variant="outline">{g.mode}</Badge><span className="truncate">{g.reason || (g.km != null ? `${g.km} km` : "")}</span></li>))}</ul></CardContent>
        </Card>
      )}
    </div>
  );
};

export default AdminAreasPage;
