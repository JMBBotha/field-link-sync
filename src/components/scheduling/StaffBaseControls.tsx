import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import AddressMapField from "@/components/entity/AddressMapField";

const sastIso = (date: string, time: string) => new Date(`${date}T${time}:00+02:00`).toISOString();
const sastLabel = (iso: string) => new Date(iso).toLocaleString("en-ZA", { timeZone: "Africa/Johannesburg", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

/** Starts-day-from, office base, home base (own editor or ✓ status) and blocked time/leave for one person. */
export default function StaffBaseControls({ profileId, self }: { profileId: string; self: boolean }) {
  const qc = useQueryClient();
  const { data: profile } = useQuery({
    queryKey: ["staff-base-profile", profileId],
    queryFn: async () => (await supabase.from("profiles").select("company_id, start_from, office_address, office_lat, office_lng").eq("id", profileId).maybeSingle()).data,
  });
  const { data: home } = useQuery({
    queryKey: ["staff-home-base", profileId], enabled: self,
    queryFn: async () => (await supabase.from("staff_home_bases").select("address, lat, lng").eq("profile_id", profileId).maybeSingle()).data,
  });
  const { data: hasHome } = useQuery({
    queryKey: ["has-home-base", profileId], enabled: !self,
    queryFn: async () => (await supabase.rpc("has_home_base", { p_profile_id: profileId })).data === true,
  });
  const { data: blocked = [] } = useQuery({
    queryKey: ["staff-blocked-list", profileId],
    queryFn: async () => (await supabase.from("staff_blocked_time").select("id, starts_at, ends_at, kind, reason")
      .eq("profile_id", profileId).is("archived_at", null).gte("ends_at", new Date().toISOString()).order("starts_at")).data || [],
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["staff-base-profile", profileId] }); qc.invalidateQueries({ queryKey: ["staff-blocked-list", profileId] }); qc.invalidateQueries({ queryKey: ["staff-blocked-time"] }); qc.invalidateQueries({ queryKey: ["staff-work-window"] }); };
  const fail = (e: { message: string } | null) => { if (e) { toast({ title: "Save failed", description: e.message, variant: "destructive" }); return true; } return false; };

  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [allDay, setAllDay] = useState(true);
  const [from, setFrom] = useState("08:00");
  const [to, setTo] = useState("17:00");
  const [kind, setKind] = useState<"leave" | "blocked">("leave");
  const [reason, setReason] = useState("");

  const addBlocked = async () => {
    if (!profile?.company_id) return;
    const starts = allDay ? sastIso(date, "00:00") : sastIso(date, from);
    const ends = allDay ? new Date(new Date(starts).getTime() + 86400000).toISOString() : sastIso(date, to);
    if (new Date(ends) <= new Date(starts)) { toast({ title: "End must be after start", variant: "destructive" }); return; }
    const { error } = await supabase.from("staff_blocked_time").insert({ profile_id: profileId, company_id: profile.company_id, starts_at: starts, ends_at: ends, kind, reason: reason.trim() || null });
    if (!fail(error)) { setReason(""); toast({ title: "Added" }); refresh(); }
  };
  const remove = async (id: string) => {
    const { error } = await supabase.from("staff_blocked_time").update({ archived_at: new Date().toISOString() }).eq("id", id);
    if (!fail(error)) refresh();
  };

  return (
    <div className="space-y-4">
      {self && (
        <Card><CardHeader className="pb-2"><CardTitle className="text-base">Home address</CardTitle>
          <p className="text-xs text-muted-foreground">Only you can see this. It's used to work out travel to your first job.</p></CardHeader>
          <CardContent><AddressMapField label="Home" value={home?.address} lat={home?.lat} lng={home?.lng} onSave={async (v) => {
            const { error } = await supabase.from("staff_home_bases").upsert({ profile_id: profileId, address: v.address, lat: v.lat, lng: v.lng, updated_at: new Date().toISOString() });
            if (!fail(error)) qc.invalidateQueries({ queryKey: ["staff-home-base", profileId] });
          }} /></CardContent></Card>
      )}
      <Card><CardContent className="space-y-3 pt-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">Starts day from</span>
          <Select value={profile?.start_from || ""} onValueChange={async (v) => { if (!fail((await supabase.from("profiles").update({ start_from: v }).eq("id", profileId)).error)) refresh(); }}>
            <SelectTrigger className="w-32 h-8"><SelectValue placeholder="Choose" /></SelectTrigger>
            <SelectContent><SelectItem value="home">Home</SelectItem><SelectItem value="office">Office</SelectItem></SelectContent>
          </Select>
        </div>
        {!self && <p className="text-sm">{hasHome ? "Home base set ✓" : "Home base not set"}</p>}
        {!self && <AddressMapField label="Office base (empty = company office)" value={profile?.office_address} lat={profile?.office_lat} lng={profile?.office_lng}
          onSave={async (v) => { if (!fail((await supabase.from("profiles").update({ office_address: v.address, office_lat: v.lat, office_lng: v.lng }).eq("id", profileId)).error)) refresh(); }} />}
      </CardContent></Card>
      <Card><CardHeader className="pb-2"><CardTitle className="text-base">Blocked time &amp; leave</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {blocked.length === 0 && <p className="text-xs text-muted-foreground">Nothing booked off.</p>}
          {blocked.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-2 border-b pb-2 text-sm">
              <span>{b.kind === "leave" ? "Leave" : "Blocked"} · {sastLabel(b.starts_at)} – {sastLabel(b.ends_at)}{b.reason ? ` · ${b.reason}` : ""}</span>
              <Button variant="outline" size="sm" onClick={() => remove(b.id)}>Remove</Button>
            </div>
          ))}
          <div className="grid gap-2 sm:grid-cols-2">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <Select value={kind} onValueChange={(v) => setKind(v as "leave" | "blocked")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="leave">Leave</SelectItem><SelectItem value="blocked">Blocked</SelectItem></SelectContent>
            </Select>
            <label className="flex items-center gap-2 text-sm"><Switch checked={allDay} onCheckedChange={setAllDay} />All day</label>
            {!allDay && <div className="flex items-center gap-2"><Input type="time" value={from} onChange={(e) => setFrom(e.target.value)} /><span className="text-xs">to</span><Input type="time" value={to} onChange={(e) => setTo(e.target.value)} /></div>}
            <Input placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} className="sm:col-span-2" />
          </div>
          <Button onClick={addBlocked} className="w-full">Add</Button>
        </CardContent></Card>
    </div>
  );
}
