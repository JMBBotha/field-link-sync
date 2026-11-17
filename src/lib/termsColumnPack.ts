/**
 * Pack terms into page columns that fill the left column, then the right.
 * A short section no longer sits beside a long one and leaves a hole.
 * Only the last column of the last page is allowed to end early.
 */

export interface PackedTermsPage {
  left: number[];
  right: number[];
  breakBefore: boolean;
}

export function packTermsColumns(heights: number[], firstHeight: number, pageHeight: number): PackedTermsPage[] {
  const pages: PackedTermsPage[] = [];
  const pageH = Math.max(40, pageHeight);
  let i = 0;
  let first = true;
  while (i < heights.length) {
    const budget = Math.max(40, first ? firstHeight : pageH);
    const left: number[] = [];
    const right: number[] = [];
    i = fillColumn(heights, i, budget, left);
    i = fillColumn(heights, i, budget, right);
    if (!left.length && !right.length) {
      left.push(i);
      i++;
    }
    // The first frame stays with the "Terms and conditions" heading. A break on
    // both the heading and the frame made a nearly blank page between them.
    pages.push({ left, right, breakBefore: !first });
    first = false;
  }
  return pages;
}

function fillColumn(heights: number[], start: number, budget: number, into: number[]): number {
  let used = 0;
  let i = start;
  while (i < heights.length) {
    const h = Math.max(1, heights[i]);
    if (into.length > 0 && used + h > budget) break;
    into.push(i);
    used += h;
    i++;
  }
  return i;
}

/** Content height of one continuation page, in CSS pixels of an `captureWidthPx`-wide sheet. */
export function termsPageContentPx(captureWidthPx: number, headPx: number, footPx: number): number {
  const usableWidthMm = 200;
  const pxPerMm = Math.max(1, captureWidthPx) / usableWidthMm;
  const headMm = Math.max(0, headPx) / pxPerMm;
  const footMm = Math.max(0, footPx) / pxPerMm;
  const topReserve = headMm > 0 ? headMm + 3 : 0;
  const botReserve = footMm > 0 ? footMm + 3 : 0;
  const contTop = topReserve ? 6 : 0;
  const usableMm = 297 - 10 - topReserve - botReserve - contTop;
  // The page cutter can snap a forced break up to 60px, and html2canvas paints text
  // a few px below its box. Leave that room so a clause is not sliced onto the next page.
  return Math.max(200, Math.floor(usableMm * pxPerMm) - 96);
}

function outerHeight(el: HTMLElement): number {
  const cs = getComputedStyle(el);
  return el.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
}

/**
 * Rebuild the terms block into full pages of two filled columns. The on-screen
 * row pairs stay in the DOM and are hidden for the capture, then put back.
 */
export function reflowTermsForPdf(capture: HTMLElement, pagePx: number): () => void {
  const terms = capture.querySelector<HTMLElement>("[data-pdf-terms-page]");
  const source = terms?.querySelector<HTMLElement>("[data-terms-source]");
  if (!terms || !source || pagePx < 80) return () => {};
  const atoms = Array.from(source.querySelectorAll<HTMLElement>("[data-terms-atom]"));
  if (atoms.length < 2) return () => {};

  const heights = atoms.map(outerHeight);
  const heading = terms.querySelector<HTMLElement>("[data-terms-heading]");
  const headingH = heading ? outerHeight(heading) + 8 : 0;
  const captureTop = capture.getBoundingClientRect().top;
  const termsTop = terms.getBoundingClientRect().top - captureTop;
  const into = ((termsTop % pagePx) + pagePx) % pagePx;
  let remain = pagePx - into - headingH;
  let breakFirst = false;
  if (remain < pagePx * 0.32) {
    breakFirst = true;
    remain = pagePx - headingH;
  }
  // Padding under each page keeps the cutter's 60px snap in blank space, not in a clause.
  const pad = 72;
  const packed = packTermsColumns(heights, Math.max(80, remain - pad), Math.max(80, pagePx - pad));
  if (!packed.length) return () => {};

  const places = atoms.map((el) => ({ el, parent: el.parentElement, next: el.nextSibling, keep: el.hasAttribute("data-pdf-keep") }));
  const prevSource = source.style.display;
  const hadBreak = terms.hasAttribute("data-pdf-break-before");
  const frames: HTMLElement[] = [];

  source.style.display = "none";
  if (breakFirst) terms.setAttribute("data-pdf-break-before", "");
  for (const page of packed) {
    const frame = document.createElement("div");
    frame.setAttribute("data-terms-packed-page", "");
    frame.className = "fl-terms-packed";
    if (page.breakBefore) frame.setAttribute("data-pdf-break-before", "");
    for (const col of [page.left, page.right]) {
      const box = document.createElement("div");
      box.className = "fl-terms-col";
      for (const index of col) {
        const atom = atoms[index];
        // Side-by-side keeps make the page cutter jump to the top of the other column.
        atom.removeAttribute("data-pdf-keep");
        box.appendChild(atom);
      }
      frame.appendChild(box);
    }
    terms.appendChild(frame);
    frames.push(frame);
  }

  return () => {
    for (let i = places.length - 1; i >= 0; i--) {
      const place = places[i];
      if (place.keep) place.el.setAttribute("data-pdf-keep", "");
      if (place.parent) place.parent.insertBefore(place.el, place.next);
    }
    frames.forEach((frame) => frame.remove());
    source.style.display = prevSource;
    if (!hadBreak) terms.removeAttribute("data-pdf-break-before");
  };
}
