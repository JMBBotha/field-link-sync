import { getPublicAppOrigin } from "@/lib/publicAppUrl";
import { r0QuoteOffenders } from "@/lib/zeroPriceGuard";

/** needs: what a draft still lacks before it can be sent (undefined = not checked yet). */
export type BundleCandidate = { id: string; status?: string | null; customer_id?: string | null; kind?: string; quote_number?: string | null; needs?: string[] };

type NeedLine = Parameters<typeof r0QuoteOffenders>[0][number];

/** What a draft still needs before Send (same rules as ensureQuoteReadyToSend: client + no R0 lines). */
export function draftNeeds(customerId: string | null | undefined, lines: NeedLine[]): string[] {
  const out: string[] = [];
  if (!customerId) out.push("client");
  if (!lines.some((l) => !l.parent_item_id)) out.push("lines");
  const r0 = r0QuoteOffenders(lines).length;
  if (r0) out.push(r0 === 1 ? "1 price" : `${r0} prices`);
  return out;
}

const isDraft = (r: BundleCandidate) => (r.status || "draft") === "draft";

/** Why the picked quotes can't go together, or null when they can (Johan 13 Oct; 27 Oct: ready drafts allowed). */
export function sendTogetherBlock(rows: BundleCandidate[]): string | null {
  if (rows.length < 2) return "Pick at least two quotes";
  if (rows.some((r) => r.kind && r.kind !== "estimate")) return "Only quotes can be sent together";
  const drafts = rows.filter(isDraft);
  if (drafts.some((r) => !r.needs)) return "Checking drafts…";
  const notReady = drafts.filter((r) => r.needs!.length);
  if (notReady.length) {
    const list = notReady.map((r) => `${r.quote_number || "Draft"} needs ${r.needs!.join(", ")}`).join("; ");
    return `Not ready: ${list}. Finish those, or send them one by one.`;
  }
  const c = new Set(rows.map((r) => r.customer_id || ""));
  if (c.has("") || c.size !== 1) return "All quotes must be for the same client";
  if (rows.length > 20) return "At most 20 quotes at once";
  return null;
}

export const publicBundleUrl = (token: string) => `${getPublicAppOrigin()}/quote/all/${encodeURIComponent(token)}`;
