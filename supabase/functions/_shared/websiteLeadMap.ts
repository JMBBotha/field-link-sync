/**
 * Website lead lane mapping (2026-10-19). Pure functions, unit-tested in websiteLeadMap.test.ts.
 * Fix: "quote accepted" / "book the installation" used to be swallowed by the earlier "quote" check.
 */
export type WebsiteForm = "booking" | "find-ac" | "packs" | "selection" | "shop" | "other";

export function normaliseForm(raw: unknown): WebsiteForm {
  const f = String(raw ?? "").toLowerCase().replace(/[\s_]/g, "-");
  if (f === "booking" || f === "find-ac" || f === "packs" || f === "selection" || f === "shop") return f;
  if (f === "findac" || f === "find-my-perfect-aircon") return "find-ac";
  if (f === "pack") return "packs";
  return "other";
}

export function mapServiceType(raw?: string | null, form?: WebsiteForm): string {
  const lower = String(raw ?? "").toLowerCase().trim();
  if (!lower) {
    if (form === "find-ac" || form === "packs" || form === "selection" || form === "shop") return "New Quote";
    return "General Inquiry";
  }
  // Order matters: the accepted-quote / book-the-install branch must run before the generic "quote" branch.
  if (lower.includes("quote accepted") || lower.includes("accepted quote") || lower.includes("book the installation")) return "New Installation";
  if (lower.includes("quote") || lower.includes("price") || lower.includes("estimate") || lower.includes("selection") || lower.includes("how much") || /\bpacks?\b/.test(lower)) return "New Quote";
  if (lower.includes("repair") || lower.includes("fix") || lower.includes("broken") || lower.includes("diagnos") || lower.includes("super service") || lower.includes("maintain") || lower.includes("maintenance") || lower.includes("service plan") || lower.includes("service")) return "Technical Service Call";
  if (lower.includes("install") || lower.includes("new")) return "New Quote";
  if (form === "find-ac" || form === "packs" || form === "selection" || form === "shop") return "New Quote";
  return raw ? String(raw) : "General Inquiry";
}

/** Quotes, packs and installs -> sales; repairs and services -> service; anything else stays manual (null). */
export function laneFor(mappedServiceType: string): "sales" | "service" | null {
  if (mappedServiceType === "New Quote" || mappedServiceType === "New Installation") return "sales";
  if (mappedServiceType === "Technical Service Call") return "service";
  return null;
}

/** A preferred date/time from the website is a REQUEST, never a booking. One note line, or "". */
export function requestedTimeLine(date?: string | null, time?: string | null): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(date ?? "")) ? String(date) : "";
  const t = /^\d{1,2}:\d{2}/.test(String(time ?? "")) ? String(time).slice(0, 5) : "";
  if (!d && !t) return "";
  return `Requested time (not booked yet, confirm with the client): ${[d, t].filter(Boolean).join(" ")}`;
}
