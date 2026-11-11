/**
 * Mandy must not answer a question with an unrelated tool.
 * A photo question is read_quote_line_images, never the quote total.
 * The same sentences are in the realtime session and the legacy mandy-agent prompt.
 */

/** "slide" / "quilt" → "quote" only when the sentence is obviously about a quote. */
export function normalizeQuoteMishear(text: string): string {
  return (text || "").replace(/\b(?:slides?|quilts?)\b/gi, (word: string, offset: number, src: string) => {
    const before = src.slice(Math.max(0, offset - 24), offset);
    const after = src.slice(offset + word.length, offset + word.length + 16);
    const obvious = /\b(open|last|latest|this|that|the|my|on|for|a)\s*$/i.test(before)
      || /^\s*(q[-\s]?\d|number|total)/i.test(after)
      || /\b(photo|picture|image|brochure|quote)\b/i.test(src);
    return obvious ? "quote" : word;
  });
}

export function isImageQuestion(transcript: string): boolean {
  const t = normalizeQuoteMishear(transcript);
  return /\b(photos?|pictures?|images?|brochures?)\b/i.test(t);
}

/** A model or product token to look up, e.g. AR40. */
export function imageFocus(transcript: string): string {
  const t = normalizeQuoteMishear(transcript);
  const m = t.match(/\b([A-Za-z]{1,6}\d{2,}[A-Za-z0-9/\-]*)\b/);
  return m ? m[1] : "";
}

export interface FallbackRoute {
  action: string | null;
  args: Record<string, unknown>;
  /** Spoken when nothing available answers the question. */
  speak: string | null;
}

const CANT_CHECK_PHOTOS =
  "I can't check product photos from this screen. Open the quote and ask again. I can open a quote, read its total, or list jobs.";

/**
 * Photo / brochure questions never run read_quote_total.
 * Any other request keeps the proposed tool.
 */
export function fallbackRoute(input: { transcript: string; proposed: string | null; available: string[] }): FallbackRoute {
  const transcript = normalizeQuoteMishear(input.transcript || "");
  if (!isImageQuestion(transcript)) return { action: input.proposed, args: {}, speak: null };
  if (input.available.includes("read_quote_line_images")) {
    const focus = imageFocus(transcript);
    return { action: "read_quote_line_images", args: focus ? { focus } : {}, speak: null };
  }
  return { action: null, args: {}, speak: CANT_CHECK_PHOTOS };
}

export interface LineImageFact {
  name: string;
  code: string | null;
  area: string | null;
  /** supplier_products.image_url is set. */
  catalogueImage: boolean;
  /** product_media.image_status is ready and image_url is set (the card photo). */
  cardPhoto: boolean;
  imageStatus: string | null;
  /** product_media.status is approved (the quote brochure). */
  brochure: boolean;
}

function compact(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function matchesLineFocus(line: LineImageFact, focus: string): boolean {
  const q = compact(focus);
  if (q.length < 3) return false;
  return compact(`${line.name} ${line.code || ""} ${line.area || ""}`).includes(q);
}

function photoWords(line: LineImageFact): string {
  if (line.cardPhoto) return "a product photo";
  if (line.catalogueImage) return "a catalogue image but no ready card photo";
  if (line.imageStatus) return `no product photo (image status ${line.imageStatus})`;
  return "no product photo";
}

function lineSentence(line: LineImageFact): string {
  const where = [line.name, line.code].filter(Boolean).join(" ");
  const place = line.area ? ` in ${line.area}` : "";
  const bro = line.brochure ? "an approved brochure" : "no approved brochure";
  return `${where}${place} has ${photoWords(line)} and ${bro}`;
}

/** One or two sentences. Focused lines first; otherwise the lines that are missing a card photo. */
export function quoteLineImageReport(quoteRef: string, lines: LineImageFact[], focus = ""): string {
  if (!lines.length) return `${quoteRef} has no lines, so there is no product photo to show.`;
  const hits = focus.trim() ? lines.filter((l) => matchesLineFocus(l, focus)) : [];
  const missing = lines.filter((l) => !l.cardPhoto && (l.code || l.catalogueImage || l.imageStatus));
  const shown = (hits.length ? hits : missing.length ? missing : lines).slice(0, 4);
  const body = shown.map(lineSentence).join(". ");
  const rest = lines.length - shown.length;
  const more = rest > 0 ? ` ${rest} other line${rest === 1 ? "" : "s"} not listed.` : "";
  return `${quoteRef}: ${body}.${more}`.replace(/\s+/g, " ").trim();
}
