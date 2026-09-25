/**
 * Shared speech formatter for every Mandy reply and TTS text.
 * - Rand: "R12 763" (whole rand when cents are 0) or "R9 738 and 26 cents".
 * - Quote numbers digit by digit: "Q-2026-0014" → "Q 2026 0 0 1 4".
 */

const group = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

export function speakRand(value: number): string {
  const cents = Math.round(Math.abs(Number(value) || 0) * 100);
  const sign = Number(value) < 0 ? "minus " : "";
  const rand = Math.floor(cents / 100);
  const c = cents % 100;
  return c === 0 ? `${sign}R${group(rand)}` : `${sign}R${group(rand)} and ${c} cents`;
}

/** "Q-2026-0014" → "Q 2026 0 0 1 4" (year kept as a block, sequence digit by digit). */
export function speakQuoteNumber(ref: string): string {
  const m = /^\s*([A-Za-z]+)[-\s]?(\d{4})[-\s]?(\d+)\s*$/.exec(ref);
  if (!m) return ref;
  return `${m[1].toUpperCase()} ${m[2]} ${m[3].split("").join(" ")}`;
}

// R 12 763,00 | R12 763.00 | R12763 | R 9 738,26 (space / nbsp thousands, , or . decimals)
const RAND_RE = /R\s?(\d{1,3}(?:[ \u00a0]\d{3})+|\d+)(?:[.,](\d{1,3}))?(?!\d)/g;
const QUOTE_RE = /\b(?:Q|INV|DEP)-\d{4}-\d+\b/g;

function parseRand(intPart: string, dec?: string) {
  const whole = Number(intPart.replace(/[ \u00a0]/g, ""));
  return dec ? Number(`${whole}.${dec}`) : whole;
}

/** On-screen reply text: normalise Rand amounts only. */
export function formatReplyText(text: string): string {
  return (text || "").replace(RAND_RE, (_m, i: string, d?: string) => speakRand(parseRand(i, d)));
}

/** TTS text: Rand amounts + document numbers read digit by digit. */
export function formatForSpeech(text: string): string {
  return formatReplyText(text).replace(QUOTE_RE, (m) => speakQuoteNumber(m));
}
