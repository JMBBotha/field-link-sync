/**
 * Pronoun memory for Mandy: 'it / that / the same' → last touched line,
 * 'back' → the area the last move came from. Stored in the assistant context.
 */
export interface TouchedCtx {
  last_touched_item?: string;
  last_touched_area?: string;
  last_move_from_area?: string;
}

const PRONOUN = /^\s*(it|that|this|the same( one| line| item)?|same)\s*$/i;
export const isPronoun = (ref: unknown) => typeof ref === "string" && PRONOUN.test(ref);

/** Returns a line id when the spoken ref is a pronoun we can resolve. */
export function resolveItemPronoun(ref: unknown, ctx: TouchedCtx): string | null {
  return (ref == null || ref === "" || isPronoun(ref)) && ctx.last_touched_item ? ctx.last_touched_item : null;
}

/** 'back' / 'where it was' → previous area name; pronoun area → last touched area. */
export function resolveAreaPronoun(area: unknown, ctx: TouchedCtx): string | undefined {
  const a = typeof area === "string" ? area.trim() : "";
  if (/^(back|where it was|the previous (area|one)|previous)$/i.test(a)) return ctx.last_move_from_area || undefined;
  if (isPronoun(a) || /^(there|same area|the same area)$/i.test(a)) return ctx.last_touched_area || undefined;
  return a || undefined;
}

/** Context patch after a successful action (from its result data). */
export function touchedPatch(data: Record<string, unknown> | undefined): TouchedCtx {
  if (!data) return {};
  const out: TouchedCtx = {};
  const item = data.item_id ?? data.line_id;
  if (typeof item === "string") out.last_touched_item = item;
  if (typeof data.area === "string") out.last_touched_area = data.area;
  if (typeof data.from_area === "string") out.last_move_from_area = data.from_area;
  return out;
}
