// One-off prototype seeder: creates demo sales/technician staff for a single company.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const COMPANY_ID = "d9b494c7-cdb2-4e86-b4e9-8860c3519dbd";

const PEOPLE = [
  { name: "Lisa Naidoo", email: "lisa.naidoo@demo.abrefrig.co.za", phone: "+27821110001", role: "sales", lat: -33.8300, lng: 18.6500, area: "Durbanville" },
  { name: "Pieter van Wyk", email: "pieter.vanwyk@demo.abrefrig.co.za", phone: "+27821110002", role: "sales", lat: -33.8938, lng: 18.6300, area: "Bellville" },
  { name: "Thabo Mokoena", email: "thabo.mokoena@demo.abrefrig.co.za", phone: "+27821110003", role: "technician", lat: -33.8712, lng: 18.6980, area: "Brackenfell" },
  { name: "Ayesha Patel", email: "ayesha.patel@demo.abrefrig.co.za", phone: "+27821110004", role: "technician", lat: -33.8350, lng: 18.6420, area: "Durbanville" },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  const results: any[] = [];

  for (const p of PEOPLE) {
    try {
      let userId: string | null = null;
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: p.email,
        password: crypto.randomUUID() + "Aa1!",
        email_confirm: true,
        user_metadata: { full_name: p.name },
      });
      if (createErr) {
        // Already exists — find them
        const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
        const found = list?.users?.find((u: any) => u.email === p.email);
        if (!found) throw createErr;
        userId = found.id;
      } else {
        userId = created.user!.id;
      }

      const { error: profErr } = await admin.from("profiles").upsert({
        id: userId,
        full_name: p.name,
        phone: p.phone,
        company_id: COMPANY_ID,
        participant_type: "company_staff",
        dispatch_role: p.role,
        dispatch_active: true,
        availability_status: "available",
        last_availability_update: new Date().toISOString(),
        home_base_lat: p.lat,
        home_base_lng: p.lng,
        home_lat: p.lat,
        home_lng: p.lng,
        max_travel_km: 50,
        location_tracking_enabled: true,
        onboarding_completed: true,
      }, { onConflict: "id" });
      if (profErr) throw profErr;

      await admin.from("user_roles").upsert(
        { user_id: userId, role: p.role === "sales" ? "dispatcher" : "field_agent" },
        { onConflict: "user_id,role" },
      );

      await admin.from("agent_locations").upsert(
        { agent_id: userId, latitude: p.lat, longitude: p.lng, is_available: true, last_updated: new Date().toISOString() },
        { onConflict: "agent_id" },
      );

      results.push({ name: p.name, id: userId, role: p.role, area: p.area, ok: true });
    } catch (e) {
      results.push({ name: p.name, ok: false, error: (e as Error).message });
    }
  }

  return new Response(JSON.stringify({ results }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
