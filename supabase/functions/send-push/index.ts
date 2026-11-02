// Drains push_outbox → Web Push. Called each minute by pg_cron (supabase/manual/push_cron.sql).
// Secrets come from Supabase Vault via fl_push_secret (service role only). Never log them.
// Pop-up text is ONLY push_outbox.title/body (built by fl_push_text: job type + rough area + "Tap to view"),
// never the notification row, so no client name or personal detail reaches a lock screen.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

serve(async (req) => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const secret = async (n: string) => (await db.rpc("fl_push_secret", { p_name: n })).data as string | null;
  const key = await secret("push_cron_key");
  if (!key || req.headers.get("x-push-key") !== key) return new Response("forbidden", { status: 403 });
  const [pub, priv, subj] = await Promise.all([secret("vapid_public_key"), secret("vapid_private_key"), secret("vapid_subject")]);
  if (!pub || !priv) return new Response(JSON.stringify({ error: "vapid not configured" }), { status: 500 });
  webpush.setVapidDetails(subj || "mailto:noreply@field-link-sync.lovable.app", pub, priv);
  const { data: jobs } = await db.from("push_outbox").select("id, notification_id, user_id, attempts, title, body, url")
    .is("sent_at", null).lt("attempts", 5).order("created_at").limit(100);
  let sent = 0, failed = 0;
  for (const j of jobs ?? []) {
    const { data: subs } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", j.user_id);
    const payload = JSON.stringify({ title: j.title, body: j.body, url: j.url, tag: j.notification_id });
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
    err ? failed++ : sent++;
  }
  return new Response(JSON.stringify({ sent, failed }), { headers: { "Content-Type": "application/json" } });
});
