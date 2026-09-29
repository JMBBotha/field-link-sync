/** Pure helpers: install lines linked to a unit, and the Yes/No outcomes of removing it. */
export function linkedToUnit<T>(items: T[], unitId: string, linkKey: (t: T) => string | null | undefined): T[] {
  return items.filter((t) => linkKey(t) === unitId);
}

/**
 * Remove the unit line (isUnit) and then either remove its linked install lines
 * (removeAll = true) or keep them as stand-alone lines (clear = drops the link).
 */
export function applyUnitRemoval<T>(
  items: T[],
  unitId: string,
  isUnit: (t: T) => boolean,
  linkKey: (t: T) => string | null | undefined,
  clear: (t: T) => T,
  removeAll: boolean,
): T[] {
  const out: T[] = [];
  for (const t of items) {
    if (isUnit(t)) continue;
    if (linkKey(t) === unitId) { if (!removeAll) out.push(clear(t)); continue; }
    out.push(t);
  }
  return out;
}
