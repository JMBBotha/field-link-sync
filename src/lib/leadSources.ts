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

/** Source chip colours with dark-mode variants (Johan 20 Oct 13:52: chips were white/unreadable in dark mode). */
export const LEAD_SOURCE_BADGE: Record<string, string> = {
  manual: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-400/15 dark:text-slate-200 dark:border-slate-400/30",
  facebook_lead: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-400/30",
  website_form: "bg-green-100 text-green-700 border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-400/30",
  website: "bg-green-100 text-green-700 border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-400/30",
  whatsapp: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-400/30",
  phone_call: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-400/30",
  vapi: "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-400/30",
  walk_in: "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-500/15 dark:text-purple-300 dark:border-purple-400/30",
  referral: "bg-pink-100 text-pink-700 border-pink-200 dark:bg-pink-500/15 dark:text-pink-300 dark:border-pink-400/30",
  other: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-400/15 dark:text-slate-200 dark:border-slate-400/30",
};
export const leadSourceBadgeClass = (src?: string | null) => LEAD_SOURCE_BADGE[toLeadSourceValue(src)] || LEAD_SOURCE_BADGE.manual;
