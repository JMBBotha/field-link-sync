/**
 * Single source of truth for customer lead sources.
 *
 * The DB stores canonical snake_case values (guarded by a CHECK constraint on
 * public.customers.lead_source). The UI shows friendly labels.
 * Always write `toLeadSourceValue(x)` to the DB and render `leadSourceLabel(x)`.
 */

export const LEAD_SOURCE_OPTIONS = [
  { value: "manual", label: "Manual" },
  { value: "facebook_lead", label: "Facebook Lead" },
  { value: "website_form", label: "Website Form" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "phone_call", label: "Phone Call" },
  { value: "walk_in", label: "Walk-in" },
  { value: "referral", label: "Referral" },
  { value: "other", label: "Other" },
] as const;

export type LeadSourceValue = (typeof LEAD_SOURCE_OPTIONS)[number]["value"];

export const DEFAULT_LEAD_SOURCE: LeadSourceValue = "manual";

/** Every value the DB CHECK constraint accepts (includes system-generated ones). */
export const ALLOWED_LEAD_SOURCES = [
  "manual", "referral", "website", "website_form", "social_media", "facebook_lead",
  "instagram", "whatsapp", "phone_call", "cold_call", "email_campaign", "trade_show",
  "walk_in", "vapi", "quote_picker", "csv_import", "api", "other",
] as const;

const ALIASES: Record<string, string> = {
  "walk-in": "walk_in",
  walkin: "walk_in",
  web: "website",
  "web_form": "website_form",
  webform: "website_form",
  facebook: "facebook_lead",
  fb: "facebook_lead",
  phone: "phone_call",
  call: "phone_call",
  wa: "whatsapp",
  import: "csv_import",
  voice: "vapi",
  mandy: "vapi",
};

/**
 * Normalise any input (label, legacy value, free text) to a value the DB accepts.
 * Never throws — unknown values fall back to `other`, empty falls back to the default.
 */
export function toLeadSourceValue(input?: string | null, fallback: string = DEFAULT_LEAD_SOURCE): string {
  const raw = (input ?? "").trim();
  if (!raw) return fallback;
  const key = raw.toLowerCase().replace(/[\s-]+/g, "_");
  const mapped = ALIASES[key] ?? ALIASES[raw.toLowerCase()] ?? key;
  return (ALLOWED_LEAD_SOURCES as readonly string[]).includes(mapped) ? mapped : "other";
}

/** Human-friendly label for any stored value. */
export function leadSourceLabel(input?: string | null): string {
  const value = toLeadSourceValue(input);
  const known = LEAD_SOURCE_OPTIONS.find(o => o.value === value);
  if (known) return known.label;
  return value
    .split("_")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
