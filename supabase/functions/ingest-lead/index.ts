import { createClient } from "npm:@supabase/supabase-js@2";
import { trustedCompanyId } from "../_shared/leadIntake.ts";

/**
 * ingest-lead — unified lead intake for Vapi calls, website forms,
 * Facebook Lead Ads and Google LSA.
 *
 * Phase 1 of the Lead Routing & Workflow Engine:
 *  - normalises payloads from every source into one shape
 *  - idempotency keys so a webhook retry can never double-process
 *  - deduplication / merge (phone|email -> address+contact -> company+contact)
 *  - hybrid classification (rules first, AI fallback under 0.75 confidence)
 *  - dead-letter queue for anything that blows up
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key, x-idempotency-key",
};

type Source = "vapi_call" | "website_form" | "facebook_lead_ads" | "google_lsa" | "manual" | "other";
type Intent = "sales" | "service";
type Priority = "emergency" | "same_day" | "standard";

interface NormalizedLead {
  source: Source;
  externalId: string | null;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  companyName: string | null;
  text: string; // transcript / message / description used for classification
  serviceTypeHint: string | null;
  raw: Record<string, unknown>;
}

// ---------------------------------------------------------------- utilities

function toE164(raw: unknown): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 10) digits = "27" + digits.slice(1);
  else if (digits.length === 9) digits = "27" + digits;
  if (digits.length < 8) return null;
  return "+" + digits;
}

function normEmail(raw: unknown): string | null {
  if (!raw) return null;
  const v = String(raw).trim().toLowerCase();
  return v.includes("@") ? v : null;
}

function normAddress(raw: unknown): string | null {
  if (!raw) return null;
  const v = String(raw)
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .replace(/\b(street|str)\b/g, "st")
    .replace(/\b(avenue)\b/g, "ave")
    .replace(/\b(road)\b/g, "rd")
    .replace(/\b(drive)\b/g, "dr")
    .replace(/\s+/g, " ")
    .trim();
  return v.length < 4 ? null : v;
}

async function sha256(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const SOURCE_RANK: Record<Source, number> = {
  vapi_call: 5,
  google_lsa: 4,
  facebook_lead_ads: 3,
  website_form: 2,
  manual: 1,
  other: 0,
};

// -------------------------------------------------------------- normalising

function detectSource(body: Record<string, any>, urlSource: string | null): Source {
  const explicit = (urlSource || body.source || "").toString().toLowerCase();
  if (["vapi_call", "website_form", "facebook_lead_ads", "google_lsa", "manual"].includes(explicit)) {
    return explicit as Source;
  }
  if (body.message?.type || body.call?.id || body.artifact) return "vapi_call";
  if (body.leadgen_id || body.entry?.[0]?.changes?.[0]?.value?.leadgen_id) return "facebook_lead_ads";
  if (body.leadId && body.businessName) return "google_lsa";
  if (body.formId || body.form_name) return "website_form";
  return "other";
}

function fbFieldMap(payload: any): Record<string, string> {
  const out: Record<string, string> = {};
  const fields = payload?.field_data || payload?.fields || [];
  for (const f of fields) {
    const key = String(f.name || f.key || "").toLowerCase();
    const value = Array.isArray(f.values) ? f.values[0] : f.value;
    if (key) out[key] = String(value ?? "");
  }
  return out;
}

function normalize(body: Record<string, any>, source: Source): NormalizedLead {
  const base = { source, raw: body as Record<string, unknown> };

  if (source === "vapi_call") {
    const call = body.message?.call || body.call || body;
    const analysis = body.message?.analysis || body.analysis || {};
    const structured = analysis.structuredData || body.structuredData || {};
    const transcript =
      body.message?.artifact?.transcript || body.artifact?.transcript || body.transcript || analysis.summary || "";
    return {
      ...base,
      externalId: call?.id ?? body.vapi_call_id ?? null,
      name: structured.caller_name || body.caller_name || call?.customer?.name || "Unknown Caller",
      phone: toE164(structured.caller_phone || body.caller_phone || call?.customer?.number),
      email: normEmail(structured.email || body.email),
      address: structured.address || body.address || null,
      companyName: structured.company_name || body.company_name || null,
      text: [transcript, analysis.summary, structured.service_type, body.notes].filter(Boolean).join("\n"),
      serviceTypeHint: structured.service_type || body.service_type || null,
    };
  }

  if (source === "facebook_lead_ads") {
    const value = body.entry?.[0]?.changes?.[0]?.value || body;
    const f = fbFieldMap(value);
    return {
      ...base,
      externalId: value.leadgen_id ?? body.leadgen_id ?? null,
      name: f["full_name"] || [f["first_name"], f["last_name"]].filter(Boolean).join(" ") || "Facebook Lead",
      phone: toE164(f["phone_number"] || f["phone"]),
      email: normEmail(f["email"]),
      address: f["street_address"] || f["address"] || null,
      companyName: f["company_name"] || null,
      text: [f["what_do_you_need"], f["message"], f["service"], value.form_name].filter(Boolean).join("\n"),
      serviceTypeHint: f["service"] || null,
    };
  }

  if (source === "google_lsa") {
    return {
      ...base,
      externalId: body.leadId ?? body.lead_id ?? null,
      name: body.consumerName || body.customer_name || "Google LSA Lead",
      phone: toE164(body.consumerPhoneNumber || body.phone),
      email: normEmail(body.consumerEmail || body.email),
      address: body.consumerAddress || body.address || null,
      companyName: body.businessName || null,
      text: [body.jobType, body.leadMessage || body.message, body.leadCategory].filter(Boolean).join("\n"),
      serviceTypeHint: body.jobType || body.leadCategory || null,
    };
  }

  // website_form / manual / other
  return {
    ...base,
    externalId: body.external_id ?? body.submission_id ?? null,
    name: body.name || [body.first_name, body.last_name].filter(Boolean).join(" ") || "Website Lead",
    phone: toE164(body.phone || body.phone_number),
    email: normEmail(body.email),
    address: body.address || body.customer_address || null,
    companyName: body.company_name || body.company || null,
    text: [body.message, body.notes, body.service_type, body.subject].filter(Boolean).join("\n"),
    serviceTypeHint: body.service_type || null,
  };
}

// ------------------------------------------------------------ classification

const SALES_KEYWORDS = [
  "quote", "quotation", "estimate", "price", "pricing", "how much", "cost",
  "install", "installation", "new unit", "new aircon", "upgrade", "replace",
  "buy", "purchase", "supply",
];
const SERVICE_KEYWORDS = [
  "not cooling", "no cooling", "not working", "leaking", "leak", "repair",
  "maintenance", "service", "breakdown", "broken", "fault", "error", "noise",
  "smell", "clean", "gas top", "regas", "warranty", "fix",
];
const EMERGENCY_KEYWORDS = ["emergency", "urgent", "asap", "immediately", "no cooling at all", "flooding", "sparking", "burning"];
const SAME_DAY_KEYWORDS = ["today", "same day", "this afternoon", "this morning", "as soon as possible"];

function countHits(text: string, words: string[]): number {
  return words.reduce((n, w) => (text.includes(w) ? n + 1 : n), 0);
}

interface Classification {
  intents: Intent[];
  primary: Intent | null;
  confidence: number;
  by: "rule" | "ai";
  priority: Priority;
  score: number;
}

function classifyByRules(text: string): Classification {
  const t = (text || "").toLowerCase();
  const sales = countHits(t, SALES_KEYWORDS);
  const service = countHits(t, SERVICE_KEYWORDS);
  const total = sales + service;

  const intents: Intent[] = [];
  if (sales > 0) intents.push("sales");
  if (service > 0) intents.push("service");

  let primary: Intent | null = null;
  let confidence = 0;
  if (total > 0) {
    primary = service > sales ? "service" : "sales";
    const dominant = Math.max(sales, service);
    // confidence grows with both signal strength and separation between intents
    confidence = Math.min(0.95, 0.5 + (dominant / (total + 1)) * 0.4 + Math.min(dominant, 3) * 0.05);
    if (sales === service) confidence = Math.min(confidence, 0.6);
  }

  const priority: Priority = countHits(t, EMERGENCY_KEYWORDS) > 0
    ? "emergency"
    : countHits(t, SAME_DAY_KEYWORDS) > 0
      ? "same_day"
      : "standard";

  const score = Math.max(1, Math.min(5, 2 + (priority === "emergency" ? 2 : priority === "same_day" ? 1 : 0) + (sales > 1 ? 1 : 0)));

  return { intents, primary, confidence: Number(confidence.toFixed(2)), by: "rule", priority, score };
}

async function classifyWithAi(text: string, fallback: Classification): Promise<Classification> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key || !text.trim()) return fallback;

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: "google/gemini-3.6-flash",
        messages: [
          {
            role: "system",
            content:
              "Classify HVAC lead enquiries. Reply with JSON only: " +
              '{"intents":["sales"|"service"],"primary_intent":"sales"|"service","confidence":0-1,' +
              '"priority":"emergency"|"same_day"|"standard","lead_score":1-5}. ' +
              "sales = quotes, pricing, new installs. service = repairs, faults, maintenance.",
          },
          { role: "user", content: text.slice(0, 6000) },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) return fallback;
    const json = await res.json();
    const parsed = JSON.parse(json.choices?.[0]?.message?.content ?? "{}");
    const intents = (Array.isArray(parsed.intents) ? parsed.intents : [])
      .filter((i: string) => i === "sales" || i === "service") as Intent[];
    const primary: Intent | null =
      parsed.primary_intent === "sales" || parsed.primary_intent === "service" ? parsed.primary_intent : intents[0] ?? null;
    if (!primary) return fallback;
    return {
      intents: intents.length ? intents : [primary],
      primary,
      confidence: Number(parsed.confidence ?? 0.8),
      by: "ai",
      priority: ["emergency", "same_day", "standard"].includes(parsed.priority) ? parsed.priority : fallback.priority,
      score: Math.max(1, Math.min(5, Number(parsed.lead_score) || fallback.score)),
    };
  } catch (_e) {
    return fallback;
  }
}

function serviceTypeFor(primary: Intent | null, hint: string | null): string {
  if (hint && hint.trim()) return hint.trim();
  if (primary === "service") return "Technical Service Call";
  if (primary === "sales") return "New Quote";
  return "General Inquiry";
}

// ------------------------------------------------------------------- handler

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: Record<string, any> = {};
  let source: Source = "other";
  let idempotencyKey = "";

  try {
    const expected = Deno.env.get("LEAD_INGEST_SECRET");
    const provided = req.headers.get("x-api-key");
    // When a shared secret is configured it is mandatory — a missing header
    // must NOT skip the check (previously it did, allowing anonymous ingest).
    if (expected && provided !== expected) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    body = await req.json();
    source = detectSource(body, url.searchParams.get("source"));
    const lead = normalize(body, source);

    idempotencyKey =
      req.headers.get("x-idempotency-key") ||
      body.idempotency_key ||
      (lead.externalId ? `${source}:${lead.externalId}` : `${source}:${await sha256(JSON.stringify(body))}`);

    // ---- idempotency: already processed? -------------------------------
    const { data: seen } = await supabase
      .from("leads")
      .select("id, lead_status")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (seen) {
      return new Response(JSON.stringify({ success: true, duplicate: true, lead_id: seen.id }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ---- resolve company ------------------------------------------------
    let companyId: string | null = trustedCompanyId(req, body.company_id);
    if (!companyId) {
      const { data: firstCompany } = await supabase
        .from("companies").select("id").order("created_at", { ascending: true }).limit(1).maybeSingle();
      companyId = firstCompany?.id ?? null;
    }

    // ---- classification -------------------------------------------------
    let classification = classifyByRules(lead.text);
    if (classification.confidence < 0.75) {
      classification = await classifyWithAi(lead.text, classification);
    }

    const nAddress = normAddress(lead.address);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // ---- deduplication (stop at first match) ---------------------------
    let match: any = null;
    let matchRule: string | null = null;

    if (lead.phone || lead.email) {
      const filters: string[] = [];
      if (lead.phone) filters.push(`phone.eq.${lead.phone}`);
      if (lead.email) filters.push(`email.eq.${lead.email}`);
      const { data } = await supabase
        .from("leads")
        .select("id, merge_history, interaction_history, source, lead_priority, customer_address, company_name")
        .is("merged_into_id", null)
        .is("deleted_at", null)
        .or(filters.join(","))
        .order("last_activity_at", { ascending: false })
        .limit(1);
      if (data?.length) { match = data[0]; matchRule = "exact_phone_or_email"; }
    }

    if (!match && nAddress && (lead.phone || lead.email)) {
      const filters: string[] = [];
      if (lead.phone) filters.push(`phone.eq.${lead.phone}`);
      if (lead.email) filters.push(`email.eq.${lead.email}`);
      const { data } = await supabase
        .from("leads")
        .select("id, merge_history, interaction_history, source, lead_priority")
        .is("merged_into_id", null)
        .is("deleted_at", null)
        .eq("normalized_address", nAddress)
        .gte("last_activity_at", thirtyDaysAgo)
        .or(filters.join(","))
        .order("last_activity_at", { ascending: false })
        .limit(1);
      if (data?.length) { match = data[0]; matchRule = "address_plus_contact_30d"; }
    }

    if (!match && lead.companyName && (lead.phone || lead.email)) {
      const filters: string[] = [];
      if (lead.phone) filters.push(`phone.eq.${lead.phone}`);
      if (lead.email) filters.push(`email.eq.${lead.email}`);
      const { data } = await supabase
        .from("leads")
        .select("id, merge_history, interaction_history, source, lead_priority")
        .is("merged_into_id", null)
        .is("deleted_at", null)
        .ilike("company_name", lead.companyName)
        .gte("last_activity_at", thirtyDaysAgo)
        .or(filters.join(","))
        .order("last_activity_at", { ascending: false })
        .limit(1);
      if (data?.length) { match = data[0]; matchRule = "company_plus_contact_30d"; }
    }

    const interaction = {
      at: new Date().toISOString(),
      source,
      external_id: lead.externalId,
      idempotency_key: idempotencyKey,
      summary: lead.text.slice(0, 2000),
      intents: classification.intents,
      priority: classification.priority,
    };

    // ---- merge path -----------------------------------------------------
    if (match) {
      const keepSource: Source =
        SOURCE_RANK[source] > SOURCE_RANK[(match.source ?? "other") as Source] ? source : (match.source as Source);

      const { error: mergeErr } = await supabase
        .from("leads")
        .update({
          source: keepSource,
          last_activity_at: new Date().toISOString(),
          interaction_history: [...(match.interaction_history ?? []), interaction],
          merge_history: [
            ...(match.merge_history ?? []),
            { at: interaction.at, rule: matchRule, source, external_id: lead.externalId, idempotency_key: idempotencyKey },
          ],
          intents: classification.intents,
          primary_intent: classification.primary,
          confidence: classification.confidence,
          classified_by: classification.by,
          lead_priority: classification.priority,
          lead_score: classification.score,
          raw_payload: body,
        })
        .eq("id", match.id);
      if (mergeErr) throw mergeErr;

      return new Response(
        JSON.stringify({ success: true, merged: true, merge_rule: matchRule, lead_id: match.id, classification }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ---- insert path (ON CONFLICT protects against webhook races) -------
    const insertRow: Record<string, any> = {
      source,
      external_id: lead.externalId,
      idempotency_key: idempotencyKey,
      raw_payload: body,
      phone: lead.phone,
      email: lead.email,
      normalized_address: nAddress,
      company_name: lead.companyName,
      customer_name: lead.name,
      customer_phone: lead.phone ?? "N/A",
      customer_address: lead.address || "Address pending",
      service_type: serviceTypeFor(classification.primary, lead.serviceTypeHint),
      status: "pending",
      lead_status: classification.primary ? "classified" : "new",
      priority: classification.priority === "emergency" ? "high" : classification.priority === "same_day" ? "medium" : "normal",
      lead_priority: classification.priority,
      lead_score: classification.score,
      intents: classification.intents,
      primary_intent: classification.primary,
      confidence: classification.confidence,
      classified_by: classification.by,
      interaction_history: [interaction],
      notes: lead.text.slice(0, 4000) || null,
      latitude: 0,
      longitude: 0,
      company_id: companyId,
      last_activity_at: interaction.at,
    };

    const { data: inserted, error: insertErr } = await supabase
      .from("leads")
      .insert(insertRow)
      .select("id")
      .maybeSingle();

    // 23505 = unique violation on the partial idempotency/contact indexes:
    // a concurrent delivery won the race, so return that row instead.
    if (insertErr && (insertErr as any).code !== "23505") throw insertErr;

    if (!inserted) {

      // Lost a race with a concurrent delivery — return the winner's row.
      const { data: winner } = await supabase
        .from("leads").select("id").eq("idempotency_key", idempotencyKey).maybeSingle();
      return new Response(JSON.stringify({ success: true, duplicate: true, lead_id: winner?.id ?? null }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({ success: true, created: true, lead_id: inserted.id, classification }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[ingest-lead] failure:", error);
    await supabase.from("webhook_dead_letters").insert({
      source,
      stage: "ingestion",
      idempotency_key: idempotencyKey || null,
      payload: body,
      error_message: error?.message ?? "Unknown error",
      error_detail: { stack: String(error?.stack ?? "") },
    });
    return new Response(JSON.stringify({ success: false, error: error?.message ?? "Internal error", dead_lettered: true }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
