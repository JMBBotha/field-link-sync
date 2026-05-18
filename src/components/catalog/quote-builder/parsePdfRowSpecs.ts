/**
 * Parse a PDF table row label like:
 *   "FHA35A9 (x2)  3MXM68A8  23.203  6.8  R52,086"
 * into structured AC specs: indoor model, outdoor model, BTU, kW.
 *
 * Heuristic — never throws. Returns undefined fields when not detectable.
 */
export function parsePdfRowSpecs(rawLabel: string): {
  indoorModel?: string;
  outdoorModel?: string;
  btu?: string;
  kw?: string;
} {
  if (!rawLabel) return {};

  // Strip trailing price column(s) — anything from the last "R<num>" onward
  let text = rawLabel.replace(/\s+R\s*[\d.,\s]+(?:\s+R\s*[\d.,\s]+)*\s*$/i, "").trim();

  // Find standalone decimal numbers (e.g. 23.203, 6.8). The LAST two are kW then BTU(k).
  // We deliberately exclude tokens that are part of a model code (model codes always
  // contain letters), by matching against word boundaries.
  const numRegex = /(?<![A-Za-z0-9])(\d+(?:[.,]\d+)?)(?![A-Za-z0-9])/g;
  const matches: { value: string; index: number; len: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = numRegex.exec(text)) !== null) {
    matches.push({ value: m[1], index: m.index, len: m[0].length });
  }

  let btu: string | undefined;
  let kw: string | undefined;
  if (matches.length >= 2) {
    const last = matches[matches.length - 1];
    const prev = matches[matches.length - 2];
    kw = last.value;
    btu = prev.value;
    // Remove those two numeric tokens from text (rightmost first to preserve indices)
    text = text.slice(0, last.index) + text.slice(last.index + last.len);
    text = text.slice(0, prev.index) + text.slice(prev.index + prev.len);
  } else if (matches.length === 1) {
    btu = matches[0].value;
    const only = matches[0];
    text = text.slice(0, only.index) + text.slice(only.index + only.len);
  }

  text = text.replace(/\s+/g, " ").trim();

  // Outdoor model: token starting with a digit followed by 2+ uppercase letters
  // (e.g. 3MXM68A8, 5MXM90A8). Indoor = everything before it.
  const tokens = text.split(/\s+/);
  const outdoorIdx = tokens.findIndex((t) => /^\d[A-Z]{2,}[A-Z0-9]*$/.test(t));

  let indoorModel: string | undefined;
  let outdoorModel: string | undefined;
  if (outdoorIdx > 0) {
    indoorModel = tokens.slice(0, outdoorIdx).join(" ").trim() || undefined;
    outdoorModel = tokens[outdoorIdx];
  } else if (tokens.length >= 2) {
    // Fallback: first token = indoor, second = outdoor
    indoorModel = tokens[0];
    outdoorModel = tokens[1];
  } else if (tokens.length === 1) {
    indoorModel = tokens[0];
  }

  return { indoorModel, outdoorModel, btu, kw };
}
