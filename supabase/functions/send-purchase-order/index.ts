import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUser } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const ACCOUNTS = "accounts@0800becool.co.za";
const DOCS = "Send invoices and delivery notes to: accounts@0800becool.co.za";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });
const esc = (value: unknown) => String(value ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]!));

function issuerName(legalName: string | null | undefined): string {
  const stripped = String(legalName || "").replace(/\s+t\/a\b.*$/i, "").replace(/\s+/g, " ").trim();
  if (!stripped || /massair\s+ind/i.test(stripped)) return "Massair CT (Pty) Ltd";
  return stripped;
}

function money(n: number): string {
  return "R " + (Number(n) || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = await requireUser(req);
    if (!auth.ok) return auth.response;
    const body = await req.json().catch(() => ({}));
    const poId = String(body?.po_id || "");
    if (!poId) return json({ error: "Missing purchase order" }, 400);
    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) return json({ error: "RESEND_API_KEY not set" }, 400);

    const userSb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization")! } },
    });
    const { data: po, error } = await userSb
      .from("purchase_orders")
      .select("id, company_id, po_number, status, source, supplier_emails, client_name, job_reference, subtotal, vat_amount, total, supplier:suppliers(name)")
      .eq("id", poId)
      .maybeSingle();
    if (error || !po) return json({ error: error?.message || "Purchase order not found" }, 400);
    if (po.source !== "job_shortage") return json({ error: "This purchase order is not a job shortage draft" }, 400);
    if (po.status === "sent" || po.status === "ordered" || po.status === "received") {
      return json({ success: true, already: true, po_number: po.po_number });
    }
    if (po.status !== "draft" && po.status !== "approved") return json({ error: "Only a draft can be sent" }, 400);

    const rawEmails = Array.isArray(po.supplier_emails) ? (po.supplier_emails as unknown[]) : [];
    const to = [...new Set(rawEmails.map((email) => String(email).trim().toLowerCase()))]
      .filter((email) => email.includes("@") && email !== ACCOUNTS);
    if (!to.length) return json({ error: "Type a supplier email before sending" }, 400);

    const { data: profile } = await userSb
      .from("company_profiles")
      .select("legal_name, email, is_default")
      .eq("company_id", po.company_id)
      .is("archived_at", null)
      .order("is_default", { ascending: false })
      .limit(1)
      .maybeSingle();
    const company = issuerName(profile?.legal_name);
    const mailbox = String(profile?.email || "").trim().toLowerCase();
    const fromEmail = /@0800becool\.co\.za$/i.test(mailbox) ? mailbox : "wcquotes@0800becool.co.za";

    const { data: items, error: itemError } = await userSb
      .from("purchase_order_items")
      .select("qty, model_code, description, line_total_excl_vat")
      .eq("po_id", poId)
      .order("sort_order");
    if (itemError) return json({ error: itemError.message }, 400);
    const rows = (items || []).map((line) =>
      `<tr><td>${esc(line.qty)}</td><td>${esc(line.model_code)}</td><td>${esc(line.description)}</td><td>${esc(money(Number(line.line_total_excl_vat)))}</td></tr>`).join("");
    const html = [
      `<p>${esc(company)}</p>`,
      `<p>Purchase order ${esc(po.po_number)}</p>`,
      `<table>${rows}</table>`,
      `<p>Total incl VAT ${esc(money(Number(po.total)))}</p>`,
      `<p>${esc(DOCS)}</p>`,
    ].join("");
    if (/t\/a\s*0800-?be-?cool/i.test(html) || /massair\s+ind/i.test(html) || /0800-BE-COOL/.test(`${company} <${fromEmail}>`)) {
      return json({ error: "Company name on the purchase order is not allowed" }, 400);
    }

    const files = Array.isArray(body?.file_attachments) ? body.file_attachments.slice(0, 1) : [];
    const attachment = files[0] && String(files[0].filename || "").toLowerCase().endsWith(".pdf") && typeof files[0].content === "string"
      ? [{ filename: String(files[0].filename).replace(/[^\w.\- ]+/g, "").slice(0, 120) || `${po.po_number}.pdf`, content: files[0].content }]
      : [];

    const sent = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `po-${po.id}` },
      body: JSON.stringify({
        from: `${company.replace(/[<>"]/g, "")} <${fromEmail}>`,
        to,
        cc: [ACCOUNTS],
        subject: `Purchase order ${po.po_number}`,
        html,
        attachments: attachment,
      }),
    });
    const result = await sent.json().catch(() => ({}));
    if (!sent.ok) return json({ error: "The email was not sent", detail: result }, 502);

    const marked = await userSb.from("purchase_orders").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", po.id).eq("status", po.status);
    if (marked.error) return json({ error: "Sent, but the order could not be marked sent", detail: marked.error.message }, 500);
    return json({ success: true, po_number: po.po_number, sentTo: to, cc: [ACCOUNTS] });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Could not send" }, 500);
  }
});
