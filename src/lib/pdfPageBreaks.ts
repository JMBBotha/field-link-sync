/**
 * Page-break helpers for the captured-DOM PDF pipeline.
 *
 * The document is captured as one tall canvas and split into A4 pages. Cutting at a fixed
 * page height slices text lines in half, so instead we move each cut up to the nearest
 * "quiet" pixel row: a row whose pixels are all (nearly) the same colour, i.e. the gap
 * between lines/blocks. Works for white gaps and for gaps inside tinted panels.
 */

/** True if every pixel in the row is within `tolerance` of the row's first pixel. */
export function isUniformRow(data: Uint8ClampedArray, width: number, y: number, tolerance = 10, step = 2): boolean {
  const base = y * width * 4;
  const r0 = data[base], g0 = data[base + 1], b0 = data[base + 2];
  for (let x = 0; x < width; x += step) {
    const i = base + x * 4;
    if (
      Math.abs(data[i] - r0) > tolerance ||
      Math.abs(data[i + 1] - g0) > tolerance ||
      Math.abs(data[i + 2] - b0) > tolerance
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Computes page cut positions (canvas pixel rows) for a canvas of `height` rows split into
 * pages of at most `pageRows` rows. Each cut is pulled up to the lowest quiet row within
 * `maxLookback` rows of the ideal cut (preferring the middle of a run of quiet rows); if none
 * is found (e.g. a huge image), it falls back to a hard cut so pagination always progresses.
 */
export function computePageCuts(
  isQuiet: (y: number) => boolean,
  height: number,
  pageRows: number,
  maxLookback = Math.floor(pageRows * 0.35),
): number[] {
  const cuts: number[] = [];
  let start = 0;
  while (height - start > pageRows) {
    const ideal = start + pageRows;
    let cut = ideal;
    const floor = Math.max(start + 1, ideal - maxLookback);
    for (let y = ideal; y >= floor; y--) {
      if (isQuiet(y)) {
        // Walk up through the quiet run and cut in its middle for a little breathing room.
        let top = y;
        while (top - 1 >= floor && isQuiet(top - 1)) top--;
        cut = Math.floor((top + y + 1) / 2);
        if (cut <= start) cut = y;
        break;
      }
    }
    cuts.push(cut);
    start = cut;
  }
  cuts.push(height);
  return cuts;
}
