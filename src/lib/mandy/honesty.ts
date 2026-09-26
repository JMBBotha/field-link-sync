import type { MandyResult } from "./actions";

const CLAIM = /\b(added|set|changed|updated|moved|removed|created|renamed|increased|decreased)\b[\s\S]*?(\bhours?\b|\bR\s?\d)/i;
export const HONESTY_HINT = "Say it again with the area, e.g. add 3 hours labour to Bedroom 1.";

/** Replace a claimed change when no write actually succeeded this turn. */
export function guardClaimedChange(final: string, results: MandyResult[], writes: boolean[]): string {
  const anyWrite = results.some((r, i) => writes[i] && r.ok && !r.choices?.length && !r.confirm);
  if (anyWrite || !CLAIM.test(final)) return final;
  const failed = results.find((r, i) => writes[i] && !r.ok);
  return `I didn't change anything. ${failed?.message || HONESTY_HINT}`;
}
