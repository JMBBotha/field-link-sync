import { getPublicAppOrigin } from "@/lib/publicAppUrl";

export type BundleCandidate = { id: string; status?: string | null; customer_id?: string | null; kind?: string };

/** Why the picked quotes can't go together, or null when they can (Johan 13 Oct: no drafts, one client). */
export function sendTogetherBlock(rows: BundleCandidate[]): string | null {
  if (rows.length < 2) return "Pick at least two quotes";
  if (rows.some((r) => r.kind && r.kind !== "estimate")) return "Only quotes can be sent together";
  if (rows.some((r) => (r.status || "draft") === "draft")) return "Drafts can't be sent together. Finish them first.";
  const c = new Set(rows.map((r) => r.customer_id || ""));
  if (c.has("") || c.size !== 1) return "All quotes must be for the same client";
  if (rows.length > 20) return "At most 20 quotes at once";
  return null;
}

export const publicBundleUrl = (token: string) => `${getPublicAppOrigin()}/quote/all/${encodeURIComponent(token)}`;
