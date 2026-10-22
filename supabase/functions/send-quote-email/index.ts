import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";
import { renderSignatureHtml, renderReminderSignatureHtml, renderSignatureText, isDesignedCompany, SIGNATURE_IMAGE_BASE, type SignatureCompany } from "../_shared/emailSignature.ts";
import { loadSignaturePerson, loadSignatureCompany, replyToFor } from "../_shared/signaturePerson.ts";
import { loadUnitCardsStripHtml } from "../_shared/unitCardsEmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Bumped on each release so a plain OPTIONS request shows which build is live.
const FN_VERSION = "send-guard-2026-10-17";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECENT_RESEND_MS = 2 * 60 * 1000;
const J = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const shortReason = (d: unknown): string => {
  const o = d as { message?: string; error?: string; name?: string } | null;
  return String(o?.message || o?.error || o?.name || (typeof d === "string" ? d : JSON.stringify(d ?? "")) || "unknown error").slice(0, 500);
};

function formatZAR(value: number): string {
  return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(value);
}

type Brand = { sig: SignatureCompany | null; name: string; phone: string | null; email: string | null; website: string | null; logoUrl: string | null; logoOnColour?: boolean; depositPct: number | null; validUntil: string | null };
const escH = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const firstName = (n?: string | null) => { const t = String(n || "").trim(); if (!t) return ""; return /\b(pty|ltd|cc|inc|trust|construction|estates?)\b/i.test(t) ? t : t.split(/\s+/)[0]; };

// Sender company details come from that company's own record (Johan 13 Oct 12:07: no hardcoding).
async function loadBrand(sb: any, quoteId?: string | null): Promise<Brand> {
  const b: Brand = { sig: null, name: "", phone: null, email: null, website: null, logoUrl: null, depositPct: null, validUntil: null };
  if (!quoteId) return b;
  try {
    const { data: q } = await sb.from("quotes").select("company_id, valid_until, payment_plan").eq("id", quoteId).maybeSingle();
    if (!q?.company_id) return b;
    const [{ data: prof }, { data: cs }] = await Promise.all([
      sb.from("company_profiles").select("legal_name, trading_name, phone, email, website, logo_url").eq("company_id", q.company_id).is("archived_at", null).order("is_default", { ascending: false }).order("created_at").limit(1).maybeSingle(),
      sb.from("company_settings").select("company_name, default_deposit_percentage").eq("company_id", q.company_id).order("is_primary", { ascending: false }).limit(1).maybeSingle(),
    ]);
    b.sig = await loadSignatureCompany(sb, q.company_id);
    b.name = prof?.legal_name || prof?.trading_name || cs?.company_name || "";
    if (b.sig) b.name = b.sig.legalName;
    b.phone = prof?.phone || null; b.email = prof?.email || null; b.website = prof?.website || null;
    // Sending company's own logo at the top; Massair CT = the designed logo block (Johan 13 Oct 12:09).
    // Massair CT: transparent logo straight on the blue header, no white box (Johan 13 Oct 12:52).
    b.logoOnColour = !!(b.sig && isDesignedCompany(b.sig));
    b.logoUrl = b.logoOnColour ? `${SIGNATURE_IMAGE_BASE}/logo-white.png` : (prof?.logo_url || null);
    const planPct = Number(q?.payment_plan?.stages?.[0]?.pct);
    const pct = Number.isFinite(planPct) && planPct > 0 ? planPct : Number(cs?.default_deposit_percentage);
    b.depositPct = Number.isFinite(pct) && pct > 0 && pct <= 100 ? Math.round(pct) : null;
    b.validUntil = q?.valid_until ? new Date(q.valid_until).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : null;
  } catch (e) { console.error("brand load failed", e); }
  return b;
}

// Top line on every client email (Johan 14 Oct): short company line
// from the sending company's own record, matching the PDF page head.
function topStrip(brand: Brand): string {
  const parts = [brand.name, brand.sig?.vatNo ? `VAT ${brand.sig.vatNo}` : "", brand.phone ? `Tel ${brand.phone}` : (brand.sig?.tel ? `Tel ${brand.sig.tel}` : ""), brand.email || brand.sig?.email || ""].filter(Boolean).map(escH);
  // An email is a first page: company line only, no rule (Johan 14 Oct 07:53).
  if (!parts.length) return "";
  return `<tr><td style="padding:12px 28px 10px;background:#ffffff;"><div style="font-size:10px;color:#6b7a8c;">${parts.join(" &middot; ")}</div></td></tr>`;
}

function buildHtmlEmail(brand: Brand, clientName: string, quoteNumber: string, date: string, totalAmount: number, unsubscribeUrl: string, quoteUrl?: string | null, depositRequest = false, signatureHtml = "", unitCardsHtml = "", customMessage = ""): string {
  const formattedTotal = formatZAR(totalAmount);
  const currentYear = new Date().getFullYear();
  const company = escH(brand.name || "Your installer");
  const hi = firstName(clientName);
  const deposit = brand.depositPct ? `A ${brand.depositPct}% deposit is due on acceptance.` : "";
  const validity = brand.validUntil ? `This quote is valid until <strong>${escH(brand.validUntil)}</strong>.` : "This quote is valid for <strong>30 days</strong> from the date of issue.";
  const contact = brand.phone ? `call us on ${escH(brand.phone)}` : "reply to this email";
  const row = (k: string, v: string, top = true) => `<tr><td style="padding:10px 14px;color:#6b7a8c;${top ? "border-top:1px solid #e3eaf2;" : ""}">${k}</td><td style="padding:10px 14px;text-align:right;${top ? "border-top:1px solid #e3eaf2;" : ""}">${v}</td></tr>`;

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Your quotation from ${company}</title></head>
<body style="margin:0;padding:0;background-color:#eef3f9;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef3f9;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;">
  ${topStrip(brand)}
  <tr><td style="background:#0B4FA8;background-image:linear-gradient(90deg,#0B4FA8,#1AA7EC);padding:22px 28px;color:#ffffff;">
    ${brand.logoUrl && brand.logoOnColour ? `<img src="${escH(brand.logoUrl)}" alt="${company}" width="200" style="display:block;width:200px;max-width:200px;height:auto;border:0;margin-bottom:10px;">` : brand.logoUrl ? `<div style="background:#ffffff;border-radius:8px;display:inline-block;padding:6px 10px;margin-bottom:10px;"><img src="${escH(brand.logoUrl)}" alt="${company}" width="180" style="display:block;width:180px;max-width:180px;height:auto;border:0;"></div>` : ""}
    <div style="font-size:20px;font-weight:800;">${company}</div>
    <div style="font-size:12px;opacity:.9;">${depositRequest ? "Your deposit invoice is ready" : "Your quotation is ready"}</div>
  </td></tr>
  <tr><td style="padding:24px 28px;color:#1d2a3a;font-size:14px;line-height:1.5;">
    ${hi ? `Hi ${escH(hi)},` : "Hello,"}<br><br>
    ${depositRequest ? `Thank you for accepting your quotation.${brand.depositPct ? ` Your ${brand.depositPct}% deposit invoice is ready.` : " Your deposit invoice is ready."} Use the button below to view and pay it.` : customMessage ? escH(customMessage).replace(/\n/g, "<br>") : "Thank you for the opportunity. Your quotation is ready to view online."}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;border:1px solid #e3eaf2;border-radius:8px;border-collapse:separate;font-size:13px;">
      ${row("Quote", `<b>${escH(quoteNumber || "—")}</b>`, false)}
      ${row("Date", escH(date))}
      ${!depositRequest && brand.validUntil ? row("Valid until", escH(brand.validUntil)) : ""}
      <tr><td style="padding:12px 14px;font-weight:800;color:#0B4FA8;border-top:3px solid #F7941D;">Total incl. VAT</td><td style="padding:12px 14px;text-align:right;font-weight:800;color:#0B4FA8;font-size:18px;border-top:3px solid #F7941D;">${formattedTotal}</td></tr>
    </table>
    ${quoteUrl ? `<div style="text-align:center;margin:22px 0 8px;"><a href="${escH(quoteUrl)}" style="display:inline-block;background:#F7941D;color:#ffffff;text-decoration:none;font-size:17px;font-weight:800;padding:16px 56px;border-radius:8px;">${depositRequest ? "View &amp; pay deposit" : "View quote"}</a></div>
    <div style="text-align:center;font-size:12px;color:#6b7a8c;">${depositRequest ? "" : "Open the quote to see every line, then accept it or ask for changes there.<br>"}${depositRequest ? "" : "The full quote PDF is attached."}</div>
    <div style="text-align:center;font-size:11px;color:#9aa7b5;margin-top:8px;word-break:break-all;">If the button does not work, copy this link: ${escH(quoteUrl)}</div>`
    : `<p style="text-align:center;font-size:13px;color:#6b7a8c;">To accept, ${contact}.</p>`}
    <div style="margin-top:22px;">${unitCardsHtml}</div>
    ${depositRequest ? "" : `<p style="margin:0 0 8px;font-size:12px;color:#6b7a8c;">⏱ ${validity}${deposit ? " " + deposit : ""}</p>`}
    <div style="margin-top:18px;border-top:1px solid #e3eaf2;padding-top:16px;">${signatureHtml || renderSignatureHtml(null)}</div>
  </td></tr>
  <tr><td style="background:#f2f9fe;padding:12px 28px;font-size:10px;color:#9aa7b5;line-height:1.5;">
    This email and any attachments are confidential and intended solely for the addressee. Prices are in South African Rand (ZAR) and include VAT at 15% where indicated. E&amp;OE. Terms and conditions apply, see the quotation. © ${currentYear} ${company}.<br>
    You received this email because you asked ${company} for a quote. <a href="${unsubscribeUrl}" style="color:#64748b;">Unsubscribe from marketing emails</a>
  </td></tr>
</table></td></tr></table></body></html>`;
}

// Several quotes for one client in ONE email with ONE "View all quotes" button (Johan 13 Oct 14:58).
type BundleRow = { quote_number: string | null; summary: string | null; total: number | null; valid_until: string | null };
function buildBundleHtml(brand: Brand, clientName: string, rows: BundleRow[], url: string, unsubscribeUrl: string, signatureHtml: string): string {
  const company = escH(brand.name || "Your installer");
  const hi = firstName(clientName);
  const fd = (d: string | null) => d ? new Date(d).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : "";
  const list = rows.map((r, i) => `<tr><td style="padding:10px 14px;${i ? "border-top:1px solid #e3eaf2;" : ""}vertical-align:top;"><b>${escH(r.quote_number || "Quote")}</b>${r.summary ? `<div style="font-size:12px;color:#4b5b6e;margin-top:2px;">${escH(r.summary)}</div>` : ""}${r.valid_until ? `<div style="font-size:11px;color:#9aa7b5;margin-top:2px;">Valid until ${escH(fd(r.valid_until))}</div>` : ""}</td><td style="padding:10px 14px;${i ? "border-top:1px solid #e3eaf2;" : ""}text-align:right;vertical-align:top;white-space:nowrap;font-weight:800;color:#0B4FA8;">${formatZAR(Number(r.total) || 0)}</td></tr>`).join("");
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Your quotations from ${company}</title></head>
<body style="margin:0;padding:0;background-color:#eef3f9;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef3f9;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px;overflow:hidden;">
  ${topStrip(brand)}
  <tr><td style="background:#0B4FA8;background-image:linear-gradient(90deg,#0B4FA8,#1AA7EC);padding:22px 28px;color:#ffffff;">
    ${brand.logoUrl && brand.logoOnColour ? `<img src="${escH(brand.logoUrl)}" alt="${company}" width="200" style="display:block;width:200px;max-width:200px;height:auto;border:0;margin-bottom:10px;">` : brand.logoUrl ? `<div style="background:#ffffff;border-radius:8px;display:inline-block;padding:6px 10px;margin-bottom:10px;"><img src="${escH(brand.logoUrl)}" alt="${company}" width="180" style="display:block;width:180px;max-width:180px;height:auto;border:0;"></div>` : ""}
    <div style="font-size:20px;font-weight:800;">${company}</div>
    <div style="font-size:12px;opacity:.9;">Your ${rows.length} quotations are ready</div>
  </td></tr>
  <tr><td style="padding:24px 28px;color:#1d2a3a;font-size:14px;line-height:1.5;">
    ${hi ? `Hi ${escH(hi)},` : "Hello,"}<br><br>
    Thank you for the opportunity. As requested, here are ${rows.length} options for you to compare. Each one can be accepted on its own.
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;border:1px solid #e3eaf2;border-radius:8px;border-collapse:separate;font-size:13px;">${list}
      <tr><td colspan="2" style="padding:0;border-top:3px solid #F7941D;font-size:0;line-height:0;">&nbsp;</td></tr>
    </table>
    <div style="text-align:center;font-size:11px;color:#6b7a8c;margin-top:-10px;">Totals include VAT.</div>
    <div style="text-align:center;margin:22px 0 8px;"><a href="${escH(url)}" style="display:inline-block;background:#F7941D;color:#ffffff;text-decoration:none;font-size:17px;font-weight:800;padding:16px 48px;border-radius:8px;">View all quotes</a></div>
    <div style="text-align:center;font-size:12px;color:#6b7a8c;">Open each quote to see every line, then accept it or ask for changes there.</div>
    <div style="text-align:center;font-size:11px;color:#9aa7b5;margin-top:8px;word-break:break-all;">If the button does not work, copy this link: ${escH(url)}</div>
    <div style="margin-top:18px;border-top:1px solid #e3eaf2;padding-top:16px;">${signatureHtml || renderSignatureHtml(null)}</div>
  </td></tr>
  <tr><td style="background:#f2f9fe;padding:12px 28px;font-size:10px;color:#9aa7b5;line-height:1.5;">
    This email is confidential and intended solely for the addressee. Prices are in South African Rand (ZAR) and include VAT at 15% where indicated. E&amp;OE. Terms and conditions apply, see each quotation. © ${new Date().getFullYear()} ${company}.<br>
    You received this email because you asked ${company} for a quote. <a href="${unsubscribeUrl}" style="color:#64748b;">Unsubscribe from marketing emails</a>
  </td></tr>
</table></td></tr></table></body></html>`;
}

// The quote must belong to the caller's company (profile company or company membership).
async function loadQuoteForSend(sb: any, quoteId: string, userId: string): Promise<QuoteForSend | null> {
  const { data: q } = await sb.from("quotes").select("id, company_id, quote_number, status, customer_id, lead_id, total").eq("id", quoteId).maybeSingle();
  if (!q?.company_id) return null;
  const [{ data: prof }, { data: mem }] = await Promise.all([
    sb.from("profiles").select("company_id").eq("id", userId).maybeSingle(),
    sb.from("company_members").select("id").eq("user_id", userId).eq("company_id", q.company_id).limit(1).maybeSingle(),
  ]);
  return prof?.company_id === q.company_id || mem?.id ? q : null;
}
type QuoteForSend = { id: string; company_id: string; quote_number: string | null; status: string | null; customer_id: string | null; lead_id: string | null; total: number | null };
type ClaimArgs = { q: QuoteForSend; sendId: string; kind: string; recipient: string; cc: string[] | null; userId: string; retryOf: string | null; confirmResend: boolean; status: "queued" | "sending" };

/**
 * Takes (or continues) the per-quote send lock. Returns the send row, or a ready 409/502/200 reply:
 *  - same sendId already finished → replay its result, never email again
 *  - another send of this quote queued/sending → SEND_IN_PROGRESS (hard lock, unique index)
 *  - this quote went to this address < 2 min ago and no confirm_resend → RECENTLY_SENT
 */
async function claimSend(sb: any, a: ClaimArgs): Promise<{ row: { id: string } } | { response: Response }> {
  await sb.rpc("expire_stale_quote_email_sends", { p_quote_id: a.q.id });
  const { data: same } = await sb.from("quote_email_sends").select("id, status, resend_id, error, recipient, started_at").eq("send_id", a.sendId).maybeSingle();
  if (same) {
    if (same.status === "queued" && a.status === "sending") {
      const { data: moved } = await sb.from("quote_email_sends").update({ status: "sending", cc: a.cc?.length ? a.cc : null }).eq("id", same.id).eq("status", "queued").select("id").maybeSingle();
      if (moved) return { row: moved };
    }
    if (same.status === "queued" && a.status === "queued") return { row: same };
    if (same.status === "sent") return { response: J({ success: true, id: same.resend_id, replay: true, sendRowId: same.id }) };
    if (same.status === "failed") return { response: J({ error: same.error, code: "SEND_FAILED", reason: same.error, sendRowId: same.id }, 502) };
    return { response: J({ error: "This send is still in progress", code: "SEND_IN_PROGRESS", sentTo: same.recipient, startedAt: same.started_at }, 409) };
  }
  const inProgress = async () => {
    const { data: active } = await sb.from("quote_email_sends").select("recipient, started_at").eq("quote_id", a.q.id).in("status", ["queued", "sending"]).limit(1).maybeSingle();
    return active ? J({ error: `Already sending this quote to ${active.recipient}`, code: "SEND_IN_PROGRESS", sentTo: active.recipient, startedAt: active.started_at }, 409) : null;
  };
  const busy = await inProgress();
  if (busy) return { response: busy };
  if (!a.confirmResend) {
    const since = new Date(Date.now() - RECENT_RESEND_MS).toISOString();
    const { data: recent } = await sb.from("quote_email_sends").select("recipient, finished_at")
      .eq("quote_id", a.q.id).eq("kind", a.kind).eq("status", "sent").eq("recipient", a.recipient).gte("finished_at", since)
      .order("finished_at", { ascending: false }).limit(1).maybeSingle();
    if (recent) return { response: J({ error: `This quote was just sent to ${recent.recipient}`, code: "RECENTLY_SENT", sentTo: recent.recipient, sentAt: recent.finished_at }, 409) };
  }
  const { data: ins, error: insErr } = await sb.from("quote_email_sends").insert({
    send_id: a.sendId, quote_id: a.q.id, company_id: a.q.company_id, kind: a.kind, recipient: a.recipient, cc: a.cc?.length ? a.cc : null,
    status: a.status, created_by: a.userId, retry_of: a.retryOf, attempts: await nextAttempt(sb, a.retryOf),
  }).select("id").single();
  if (insErr) return { response: (await inProgress()) || J({ error: insErr.message }, 500) };
  return { row: ins };
}

// Any queued/sending row for this press that ends without a Resend result → failed + alert.
async function failBySendId(sb: any, sendId: string | null, reason: string) {
  if (!sendId) return;
  const { data: rows } = await sb.from("quote_email_sends").update({ status: "failed", error: reason.slice(0, 500), finished_at: new Date().toISOString() })
    .eq("send_id", sendId).in("status", ["queued", "sending"]).select("id");
  for (const r of rows || []) await sb.rpc("notify_quote_email_failed", { p_send: r.id });
}

async function nextAttempt(sb: any, retryOf: string | null): Promise<number> {
  if (!retryOf) return 1;
  const { data } = await sb.from("quote_email_sends").select("attempts").eq("id", retryOf).maybeSingle();
  return (Number(data?.attempts) || 1) + 1;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { ...corsHeaders, "X-Fn-Version": FN_VERSION } });
  }

  // Prevent this branded sender from being used as an open relay.
  const auth = await requireUser(req);
  if (!auth.ok) return auth.response;

  let currentSendId: string | null = null;
  try {
    const reqBody = await req.json();
    const { to, subject, quoteNumber, message, copyToCompany, clientName, pdfBase64, totalAmount, unsubscribeToken, quoteId, customerId, region, quoteUrl, depositRequest } = reqBody;
    // Duplicate-send guard (17 Oct 2026): one sendId per Email press (Resend Idempotency-Key + send record).
    const sendId: string | null = typeof reqBody.sendId === "string" && UUID_RE.test(reqBody.sendId) ? reqBody.sendId : null;
    const confirmResend = reqBody.confirm_resend === true;
    currentSendId = reqBody?.previewOnly === true ? null : sendId;
    const retryOf: string | null = typeof reqBody.retryOf === "string" && UUID_RE.test(reqBody.retryOf) ? reqBody.retryOf : null;
    // Extra recipients the sender typed in (comma-separated string or array). Validated, deduped, max 5.
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const extraRecipients: string[] = Array.from(new Set<string>(
      (Array.isArray(reqBody.cc) ? reqBody.cc : String(reqBody.cc || "").split(","))
        .map((e: unknown) => String(e || "").trim().toLowerCase())
        .filter((e: string) => EMAIL_RE.test(e) && e !== String(to || "").trim().toLowerCase()),
    )).slice(0, 5);

    // Admin "send test signature to myself": goes ONLY to the logged-in admin's own login email. Never to a client.
    if (reqBody?.signatureTest === true) {
      if (!auth.userId || !(auth.roles || []).includes("admin")) {
        return new Response(JSON.stringify({ error: "Admins only" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: u } = await sb.auth.admin.getUserById(auth.userId as string);
      const self = u?.user?.email;
      const key = Deno.env.get("RESEND_API_KEY");
      if (!self || !key) {
        return new Response(JSON.stringify({ error: !self ? "No login email" : "RESEND_API_KEY not set" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const me = await loadSignaturePerson(sb, auth.userId);
      const { data: myProf } = await sb.from("profiles").select("company_id").eq("id", auth.userId).maybeSingle();
      const myCo = await loadSignatureCompany(sb, myProf?.company_id);
      const mailbox = Deno.env.get("QUOTES_FROM_EMAIL") || "wcquotes@0800becool.co.za";
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: `${(myCo?.legalName || "Quotes").replace(/[<>"]/g, "")} <${mailbox}>`, to: [self], subject: "Test: your email signature",
          html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111827">This is a test of your email signature. Replies go to: ${replyToFor(me) || mailbox}</div>${renderSignatureHtml(me, undefined, myCo)}<hr/><p style="font-family:Arial;font-size:12px;color:#6b7280">Automatic reminder version:</p>${renderReminderSignatureHtml(me, undefined, myCo)}`,
          ...(replyToFor(me) ? { reply_to: replyToFor(me) } : {}),
        }),
      });
      const rd = await r.json().catch(() => ({}));
      return new Response(JSON.stringify({ success: r.ok, sentTo: self, resend: rd }), { status: r.ok ? 200 : 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (reqBody?.bundleToken) {
      const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      const { data: me } = await sb.from("profiles").select("company_id").eq("id", auth.userId).maybeSingle();
      const { data: b } = await sb.from("quote_bundles").select("*").eq("token", reqBody.bundleToken).maybeSingle();
      if (!b || !me?.company_id || b.company_id !== me.company_id) return J({ error: "Bundle not found" }, 404);
      const { data: pub } = await sb.rpc("public_quote_bundle", { p_token: b.token });
      const rows: BundleRow[] = (pub?.quotes || []) as BundleRow[];
      if (rows.length < 2) return J({ error: "Bundle needs at least two non-draft quotes" }, 400);
      const { data: cust } = await sb.from("customers").select("name, company_name, email").eq("id", b.customer_id).maybeSingle();
      const clientName = cust?.name || cust?.company_name || pub?.customer_name || "";
      const origin = (typeof reqBody.appOrigin === "string" && /^https:\/\/[a-z0-9.-]+$/i.test(reqBody.appOrigin)) ? reqBody.appOrigin : "https://field-link-sync.lovable.app";
      const url = `${origin}/quote/all/${b.token}`;
      const brand = await loadBrand(sb, b.quote_ids[0]);
      const sender = await loadSignaturePerson(sb, auth.userId);
      const dest = String(to || cust?.email || "").trim();
      const unsubToken = crypto.randomUUID();
      const fnUrl = Deno.env.get("SUPABASE_URL")!.replace(".supabase.co", ".supabase.co/functions/v1");
      const unsubscribeUrl = `${fnUrl}/unsubscribe?token=${unsubToken}&email=${encodeURIComponent(dest)}`;
      const html = buildBundleHtml(brand, clientName, rows, url, unsubscribeUrl, renderSignatureHtml(sender, undefined, brand.sig));
      if (reqBody.previewOnly === true) return J({ success: true, preview: true, html, url });
      if (!dest) return J({ error: "Missing 'to' email address" }, 400);
      const { data: pref } = await sb.from("email_preferences").select("unsubscribed").eq("email", dest.toLowerCase()).maybeSingle();
      if (pref?.unsubscribed) return J({ success: false, skipped: true, reason: "Recipient has unsubscribed from marketing emails." });
      await sb.from("email_preferences").upsert({ email: dest.toLowerCase(), unsubscribe_token: unsubToken, updated_at: new Date().toISOString() }, { onConflict: "email" });
      const key = Deno.env.get("RESEND_API_KEY");
      if (!key?.trim()) return J({ error: "Email not configured", code: "EMAIL_NOT_CONFIGURED" }, 503);
      const mailbox = Deno.env.get("QUOTES_FROM_EMAIL") || "wcquotes@0800becool.co.za";
      const refs = rows.map((r) => r.quote_number).filter(Boolean).join(", ");
      const hiTxt = firstName(clientName) ? `Hi ${firstName(clientName)},` : "Hello,";
      const text = `${hiTxt}\n\nHere are ${rows.length} quotes for you to compare:\n${rows.map((r) => `- ${r.quote_number}${r.summary ? `: ${r.summary}` : ""} (${formatZAR(Number(r.total) || 0)} incl. VAT)`).join("\n")}\n\nView all quotes: ${url}\nYou can accept each one or ask for changes there.\n\nKind regards,\n\n${renderSignatureText(sender, brand.sig)}`;
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(sendId ? { "Idempotency-Key": `quote-bundle/${sendId}` } : {}) },
        body: JSON.stringify({
          from: `${(brand.name || "Quotes").replace(/[<>"]/g, "")} <${mailbox}>`, reply_to: replyToFor(sender) || mailbox, to: [dest],
          subject: `Your ${rows.length} quotes from ${brand.name || "us"} [Ref: ${refs}]`, html, text,
          headers: { "X-BeCool-Quote-Ref": refs || "bundle", "X-BeCool-Bundle-Id": String(b.id), ...(b.customer_id ? { "X-BeCool-Customer-Id": String(b.customer_id) } : {}) },
          tags: [{ name: "type", value: "quote_bundle" }],
        }),
      });
      const rd = await r.json().catch(() => ({}));
      if (!r.ok) { console.error("Resend bundle error", rd); return J({ error: "Failed to send email", details: rd }, 500); }
      // Log a send on every quote in the bundle.
      const now = new Date().toISOString();
      const { data: qs } = await sb.from("quotes").select("id, quote_number, total, lead_id").in("id", b.quote_ids).neq("status", "draft");
      for (const q of qs || []) {
        await sb.from("quotes").update({ sent_at: now, sent_by: auth.userId, sent_method: "email_bundle", sent_channel: "email" }).eq("id", q.id);
        await sb.from("communication_log").insert({ agent_id: auth.userId, customer_id: b.customer_id, lead_id: q.lead_id || null, type: "email",
          subject: `Quote ${q.quote_number} sent (together with ${(qs || []).length - 1} other${(qs || []).length > 2 ? "s" : ""})`,
          body: `Quote ${q.quote_number} (${Number(q.total || 0).toFixed(2)} incl. VAT) was sent to ${dest} via email in one "View all quotes" email (${refs}).` });
      }
      await sb.from("quote_bundles").update({ sent_to: dest, sent_at: now }).eq("id", b.id);
      return J({ success: true, id: rd.id, sentTo: dest, url });
    }

    // Step 1 of an Email press: take the per-quote lock BEFORE the PDF is built, so a second
    // press / device / user is refused while this one is still building or sending.
    if (reqBody?.beginSend === true || reqBody?.reportFailure === true) {
      const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      if (!sendId || !quoteId || !to) return J({ error: "sendId, quoteId and to are required" }, 400);
      const q = await loadQuoteForSend(sb, quoteId, auth.userId as string);
      if (!q) return J({ error: "Quote not found" }, 404);
      const recipient = String(to).trim().toLowerCase();
      const kind = depositRequest ? "deposit" : "quote";
      if (reqBody.beginSend === true) {
        const { data: pref } = await sb.from("email_preferences").select("unsubscribed").eq("email", recipient).maybeSingle();
        if (pref?.unsubscribed) return J({ success: false, skipped: true, reason: "Recipient has unsubscribed from marketing emails." });
        const claim = await claimSend(sb, { q, sendId, kind, recipient, cc: null, userId: auth.userId as string, retryOf, confirmResend, status: "queued" });
        if ("response" in claim) return claim.response;
        return J({ success: true, queued: true, sendRowId: claim.row.id });
      }
      // The app could not finish (e.g. the PDF failed to build): record why and alert. Nothing was emailed.
      const reason = String(reqBody.reason || "The quote PDF could not be built").slice(0, 500);
      const now = new Date().toISOString();
      const { data: existing } = await sb.from("quote_email_sends").select("id, status").eq("send_id", sendId).maybeSingle();
      let rowId = existing?.id as string | undefined;
      if (existing && existing.status !== "queued") return J({ success: true, recorded: false, status: existing.status, sendRowId: existing.id });
      if (existing) {
        await sb.from("quote_email_sends").update({ status: "failed", error: reason, finished_at: now }).eq("id", existing.id).eq("status", "queued");
      } else {
        const { data: row, error: insErr } = await sb.from("quote_email_sends").insert({
          send_id: sendId, quote_id: q.id, company_id: q.company_id, kind, recipient, status: "failed", error: reason,
          created_by: auth.userId, retry_of: retryOf, attempts: await nextAttempt(sb, retryOf), finished_at: now,
        }).select("id").single();
        if (insErr) return J({ error: insErr.message }, 500);
        rowId = row.id;
      }
      await sb.rpc("notify_quote_email_failed", { p_send: rowId });
      return J({ success: true, recorded: true, sendRowId: rowId });
    }

    if (!to) {
      return new Response(JSON.stringify({ error: "Missing 'to' email address" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create Supabase client for DB operations
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Check if recipient has unsubscribed
    const { data: pref } = await supabase
      .from("email_preferences")
      .select("unsubscribed")
      .eq("email", to.toLowerCase())
      .maybeSingle();

    if (pref?.unsubscribed) {
      await failBySendId(supabase, sendId, "Recipient has unsubscribed from marketing emails.");
      return new Response(
        JSON.stringify({ success: false, skipped: true, reason: "Recipient has unsubscribed from marketing emails." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Generate token and upsert into email_preferences
    const token = unsubscribeToken || crypto.randomUUID();

    await supabase
      .from("email_preferences")
      .upsert(
        { email: to.toLowerCase(), unsubscribe_token: token, updated_at: new Date().toISOString() },
        { onConflict: "email" },
      );

    const supabaseFunctionsUrl = supabaseUrl.replace("https://", "https://").replace(".supabase.co", ".supabase.co/functions/v1");
    const unsubscribeUrl = `${supabaseFunctionsUrl}/unsubscribe?token=${token}&email=${encodeURIComponent(to)}`;

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

    if (!RESEND_API_KEY || !RESEND_API_KEY.trim()) {
      console.error("RESEND_API_KEY not configured – refusing to fake a send");
      await failBySendId(supabase, sendId, "Email is not configured on the server (no email service key).");
      return new Response(
        JSON.stringify({
          error: "Email not configured",
          code: "EMAIL_NOT_CONFIGURED",
          message: "RESEND_API_KEY is not set. Configure Resend in project secrets to enable quote email.",
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    
    // Sender mailbox: Western Cape quotes mailbox on the verified 0800becool.co.za domain.
    const QUOTES_MAILBOX = Deno.env.get("QUOTES_FROM_EMAIL") || "wcquotes@0800becool.co.za";
    const brand = await loadBrand(supabase, quoteId);
    const FROM_ADDRESS = `${(brand.name || "Quotes").replace(/[<>"]/g, "")} <${QUOTES_MAILBOX}>`;

    // Stable quote reference used in the subject, headers and metadata so that
    // client replies can be linked back to the correct quote / customer.
    const quoteRef = quoteNumber || (quoteId ? `Q-${String(quoteId).slice(0, 8)}` : "");
    const baseSubject = subject || `Your quote from ${brand.name || "us"}`;
    const emailSubject = quoteRef && !baseSubject.includes(quoteRef)
      ? `${baseSubject} [Ref: ${quoteRef}]`.trim()
      : baseSubject.trim();

    const date = new Date().toLocaleDateString("en-ZA");
    // Signature + reply-to: the person who clicked Send (Johan 12 Oct: replies go to the sender's own address).
    const sender = await loadSignaturePerson(supabase, auth.userId);
    const customMessage = typeof message === "string" ? message.trim().slice(0, 4000) : "";
    const htmlBody = buildHtmlEmail(brand, clientName, quoteNumber, date, totalAmount || 0, unsubscribeUrl, quoteUrl || null, Boolean(depositRequest), renderSignatureHtml(sender, undefined, brand.sig), depositRequest ? "" : await loadUnitCardsStripHtml(supabase, quoteId), depositRequest ? "" : customMessage);
    const hiTxt = firstName(clientName) ? `Hi ${firstName(clientName)},` : "Hello,";
    const textFallback = depositRequest
      ? `${hiTxt}\n\nThank you for accepting quote ${quoteRef}. Your ${brand.depositPct ? brand.depositPct + "% " : ""}deposit invoice is ready.${quoteUrl ? `\n\nView and pay it here: ${quoteUrl}` : ""}\n\nKind regards,\n\n${renderSignatureText(sender, brand.sig)}`
      : `${hiTxt}\n\n${customMessage ? customMessage + "\n\n" : ""}Your quote ${quoteRef ? `(${quoteRef}) ` : ""}totalling ${formatZAR(totalAmount || 0)} is ready.${quoteUrl ? `\n\nView quote: ${quoteUrl}\nYou can accept it or ask for changes there.` : ""}\n\n${brand.validUntil ? `Valid until ${brand.validUntil}.` : "Valid for 30 days."}${brand.depositPct ? ` A ${brand.depositPct}% deposit is due on acceptance.` : ""}\n\nKind regards,\n\n${renderSignatureText(sender, brand.sig)}`;
    // Preview only: return the exact HTML that would be sent, without sending.
    if (reqBody.previewOnly === true) {
      return new Response(JSON.stringify({ success: true, preview: true, html: htmlBody, subject: emailSubject }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const attachments: Array<{ filename: string; content: string }> = [];
    if (pdfBase64) {
      attachments.push({ filename: `Quote-${quoteRef || "draft"}.pdf`, content: pdfBase64 });
    }
    // Staff-attached documents (quote_documents) go out with the quote email; cap ~25 MB total.
    if (quoteId && !depositRequest) {
      const { data: docs } = await supabase.from("quote_documents").select("storage_path, filename").eq("quote_id", quoteId).order("created_at");
      let total = 0;
      for (const d of docs || []) {
        const { data: blob } = await supabase.storage.from("quote-documents").download(d.storage_path);
        if (!blob) continue;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (total + bytes.length > 25 * 1024 * 1024) break;
        total += bytes.length;
        let bin = "";
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        attachments.push({ filename: d.filename, content: btoa(bin) });
      }
    }

    // Custom headers travel with the message and come back on replies (In-Reply-To /
    // References threading), which is what the future inbound processor will use to
    // resolve the quote/customer without guessing from free text.
    const headers: Record<string, string> = {
      "X-BeCool-Quote-Ref": quoteRef || "unknown",
      "X-BeCool-Region": region || "western-cape",
    };
    if (quoteId) headers["X-BeCool-Quote-Id"] = String(quoteId);
    if (customerId) headers["X-BeCool-Customer-Id"] = String(customerId);

    const resendPayload: Record<string, unknown> = {
      from: FROM_ADDRESS,
      reply_to: replyToFor(sender) || QUOTES_MAILBOX,
      to: [to],
      subject: emailSubject,
      html: htmlBody,
      text: textFallback,
      headers,
      tags: [
        { name: "type", value: "quote" },
        { name: "region", value: (region || "western-cape").replace(/[^a-zA-Z0-9_-]/g, "-") },
      ],
    };
    if (attachments.length > 0) resendPayload.attachments = attachments;
    // Optional copy to the sending company's own email (company profile), never a client-chosen address.
    const companyCopy = copyToCompany === true && brand.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(brand.email) && brand.email.toLowerCase() !== String(to).toLowerCase() ? brand.email : null;
    if (companyCopy) resendPayload.bcc = [companyCopy];
    const ccList = extraRecipients.filter((e) => e !== companyCopy);
    if (ccList.length > 0) resendPayload.cc = ccList;

    // ── Send record + hard lock (only when the caller gives a quote and a sendId). ──
    const kind = depositRequest ? "deposit" : "quote";
    const recipient = String(to).trim().toLowerCase();
    let sendRow: { id: string } | null = null;
    let q: QuoteForSend | null = null;
    if (quoteId && sendId) {
      q = await loadQuoteForSend(supabase, quoteId, auth.userId as string);
      if (!q) return J({ error: "Quote not found" }, 404);
      const claim = await claimSend(supabase, { q, sendId, kind, recipient, cc: ccList, userId: auth.userId as string, retryOf, confirmResend, status: "sending" });
      if ("response" in claim) return claim.response;
      sendRow = claim.row;
    }
    const markFailed = async (reason: string) => {
      if (!sendRow) return;
      await supabase.from("quote_email_sends").update({ status: "failed", error: reason, finished_at: new Date().toISOString() }).eq("id", sendRow.id).eq("status", "sending");
      await supabase.rpc("notify_quote_email_failed", { p_send: sendRow.id });
    };

    let resendRes: Response;
    let resendData: any;
    try {
      resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json",
          ...(sendId ? { "Idempotency-Key": `quote-email/${sendId}` } : {}),
        },
        body: JSON.stringify(resendPayload),
      });
      resendData = await resendRes.json().catch(() => ({}));
    } catch (e) {
      const reason = `Could not reach the email service: ${shortReason((e as Error)?.message || e)}`;
      await markFailed(reason);
      return J({ error: reason, code: "SEND_FAILED", reason, sendRowId: sendRow?.id }, 502);
    }

    if (!resendRes.ok) {
      console.error("Resend API error:", resendData);
      const reason = `Email service refused it (${resendRes.status}): ${shortReason(resendData)}`;
      await markFailed(reason);
      return J({ error: "Failed to send email", code: "SEND_FAILED", reason, details: resendData, sendRowId: sendRow?.id }, 500);
    }

    // Accepted by Resend: record it server-side (the app no longer logs this itself).
    if (sendRow && q) {
      const now = new Date().toISOString();
      await supabase.from("quote_email_sends").update({ status: "sent", resend_id: resendData?.id || null, finished_at: now, error: null }).eq("id", sendRow.id);
      if (kind === "quote") {
        const num = q.quote_number || quoteNumber;
        const amount = Number(totalAmount ?? q.total ?? 0);
        await supabase.from("communication_log").insert({
          agent_id: auth.userId, customer_id: q.customer_id || customerId || null, lead_id: q.lead_id || null, type: "email",
          subject: `Quote ${num} sent`,
          body: `Quote ${num} (${amount.toFixed(2)} incl. VAT) was sent to ${String(to).trim()} via email.`,
        });
        // Same columns the app used to set; never pull an accepted quote back to "sent".
        const patch: Record<string, unknown> = { sent_at: now, sent_by: auth.userId, sent_channel: "email", sent_method: "email" };
        if (q.status !== "accepted") patch.status = "sent";
        await supabase.from("quotes").update(patch).eq("id", q.id);
      }
    }

    return J({ success: true, id: resendData?.id, sendRowId: sendRow?.id, logged: !!sendRow });
  } catch (err) {
    console.error("send-quote-email error:", err);
    try {
      const sid = currentSendId;
      if (sid) await failBySendId(createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!), sid, `Server error: ${shortReason((err as Error)?.message || err)}`);
    } catch (_) { /* best effort */ }
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
