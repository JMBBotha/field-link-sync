// Natural order for a project house label or number. One helper for every house picker.
const houseCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** First number in the label. Blank and numberless labels are unnumbered. */
function houseLabelNumber(label: string): number | null {
  const m = /\d+/.exec(label);
  return m ? parseInt(m[0], 10) : null;
}

/**
 * Numeric order on the house label: "4" before "4A" before "House 4" before "Unit 12".
 * The number is compared first so a different prefix cannot bury a smaller house
 * ("Unit 2" before "House 10"). The numeric collator breaks ties ("4", "4A", "House 4").
 * Blank labels and labels with no number sort last.
 */
export function compareHouseLabels(a: string | null | undefined, b: string | null | undefined): number {
  const left = (a ?? "").trim();
  const right = (b ?? "").trim();
  const ln = houseLabelNumber(left);
  const rn = houseLabelNumber(right);
  if (ln == null || rn == null) {
    if (ln == null && rn == null) return houseCollator.compare(left, right);
    return ln == null ? 1 : -1;
  }
  if (ln !== rn) return ln - rn;
  return houseCollator.compare(left, right);
}

export function sortHouseLabels<T>(items: readonly T[], labelOf: (item: T) => string | null | undefined): T[] {
  return [...items].sort((a, b) => compareHouseLabels(labelOf(a), labelOf(b)));
}
