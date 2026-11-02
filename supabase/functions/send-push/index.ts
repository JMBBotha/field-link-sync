// Drains push_outbox → Web Push. Called each minute by pg_cron (supabase/manual/push_cron.sql).
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, PUSH_CRON_KEY. Never log them.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const LINK: Record<string, string> = { request_offer: "/admin", request_offer_unclaimed: "/admin/requests", request_alert: "/admin/requests" };

serve(async (req) => {
  if (req.headers.get("x-push-key") !== Deno.env.get("PUSH_CRON_KEY")) return new Response("forbidden", { status: 403 });
  webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT")!, Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: jobs } = await db.from("push_outbox").select("id, notification_id, user_id, attempts")
    .is("sent_at", null).lt("attempts", 5).order("created_at").limit(100);
  let sent = 0;
  for (const j of jobs ?? []) {
    const { data: n } = await db.from("notifications").select("id, type, title, body").eq("id", j.notification_id).single();
    const { data: subs } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", j.user_id);
    // Offer pushes carry only what the bell shows (masked before accept).
    const payload = JSON.stringify({ title: n?.title ?? "Field Link", body: n?.body ?? "", url: LINK[n?.type ?? ""] ?? "/admin", tag: n?.id });
    let err: string | null = null;
    for (const s of subs ?? []) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 600 });
        await db.from("push_subscriptions").update({ last_ok_at: new Date().toISOString() }).eq("id", s.id);
      } catch (e: any) {
        if (e?.statusCode === 404 || e?.statusCode === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
        else err = String(e?.statusCode ?? "send failed");
      }
    }
    await db.from("push_outbox").update(err ? { attempts: j.attempts + 1, last_error: err } : { sent_at: new Date().toISOString() }).eq("id", j.id);
    if (!err) sent++;
  }
  return new Response(JSON.stringify({ sent }), { headers: { "Content-Type": "application/json" } });
});
