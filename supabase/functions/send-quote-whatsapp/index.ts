import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isWhatsAppConfigured, sendWhatsApp, toE164 } from "../_shared/whatsapp.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Normalise a South African number to WhatsApp E.164 (no plus). */
function formatPhoneNumber(phone: string): string {
  let cleaned = phone.replace(/\D/g, "");
  if (cleaned.startsWith("0")) cleaned = "27" + cleaned.slice(1);
  else if (!cleaned.startsWith("27") && cleaned.length <= 10) cleaned = "27" + cleaned;
  return cleaned;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ ok: false, error: "Unauthorized" }, 401);

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ ok: false, error: "Unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const userId = userData.user.id;
    const [{ data: isAdmin }, { data: isAgent }, { data: isDispatcher }] = await Promise.all([
      admin.rpc("has_role", { _user_id: userId, _role: "admin" }),
      admin.rpc("has_role", { _user_id: userId, _role: "field_agent" }),
      admin.rpc("has_role", { _user_id: userId, _role: "dispatcher" }),
    ]);
    if (!isAdmin && !isAgent && !isDispatcher) return json({ ok: false, error: "Forbidden" }, 403);

    const { quoteId, quoteNumber, to, clientName, totalAmount, pdfBase64 } = await req.json();
    if (!to) return json({ ok: false, error: "Recipient number is required" }, 400);

    if (!isWhatsAppConfigured()) {
      return json({ ok: false, error: "WhatsApp is not configured (missing Twilio credentials)" }, 400);
    }

    // 1. Upload the PDF so Twilio can attach it as media.
    let mediaUrl: string | null = null;
    if (pdfBase64) {
      const bytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
      const path = `${quoteId || "quote"}/${quoteNumber || "quote"}-${Date.now()}.pdf`;
      const { error: upErr } = await admin.storage
        .from("quote-pdfs")
        .upload(path, bytes, { contentType: "application/pdf", upsert: true });
      if (upErr) {
        console.error("PDF upload failed", upErr);
      } else {
        // Private bucket: hand Twilio a time-limited signed URL (7 days).
        const { data: signed, error: signErr } = await admin.storage
          .from("quote-pdfs")
          .createSignedUrl(path, 60 * 60 * 24 * 7);
        if (signErr) console.error("Signed URL failed", signErr);
        mediaUrl = signed?.signedUrl ?? null;
      }
    }

    const amount = Number(totalAmount || 0).toLocaleString("en-ZA", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const body =
      `Hi ${clientName || "there"}, here is your quotation ${quoteNumber || ""}`.trim() +
      `.\nTotal: R ${amount} (incl. VAT).` +
      (mediaUrl ? "\nThe full quote is attached as a PDF." : "") +
      `\n\n0800-BE-COOL — AC Super Service`;

    const result = await sendWhatsApp({
      to: String(to),
      body,
      mediaUrls: mediaUrl ? [mediaUrl] : [],
    });

    await admin.from("whatsapp_messages").insert({
      direction: "outbound",
      environment: result.environment,
      provider_sid: result.sid ?? null,
      from_number: "system",
      to_number: toE164(String(to)),
      body,
      media_urls: mediaUrl ? [mediaUrl] : [],
      status: result.ok ? result.status ?? "queued" : "failed",
      error_message: result.error ?? null,
      raw: { quote_id: quoteId, quote_number: quoteNumber },
    });

    if (!result.ok) {
      return json({ ok: false, error: result.error || "WhatsApp send failed" }, result.httpStatus || 502);
    }

    return json({ ok: true, sid: result.sid, mediaUrl });

  } catch (err) {
    console.error("send-quote-whatsapp error", err);
    return json({ ok: false, error: err instanceof Error ? err.message : "Unexpected error" }, 500);
  }
});
