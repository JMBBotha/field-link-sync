/** Same rule as public.normalize_model_code(): upper, no spaces, drop -DUP<n> suffix. */
export function normalizeModelCode(code?: string | null): string | null {
  const s = String(code || "").toUpperCase().replace(/\s+/g, "").replace(/-DUP\d*$/, "");
  return s || null;
}

/**
 * First model of a combo. Phase notes and quantity notes in () or [] are not
 * part of the model, so "R32-MICAS-48 (1PH) + CST-…" and "MCI-36-FS(3PH)"
 * still resolve to a unit card and an image.
 */
export function primaryModelCode(code?: string | null): string | null {
  let first = String(code || "").split("+")[0].trim();
  // A code wrapped as a whole, e.g. "[AR70F12C1FW/FA]", still names that model.
  const wrapped = first.match(/^[([]\s*([^()[\]]+?)\s*[)\]]$/);
  if (wrapped) first = wrapped[1];
  // Phase and quantity notes sit in brackets beside the model: "(1PH)", "(3Ph)", "(X2)".
  const stripped = first.replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ");
  return normalizeModelCode(stripped);
}
