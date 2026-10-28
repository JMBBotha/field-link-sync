/** Timeouts for the PDF export so it can never hang silently (Cape Estates Q-2026-0052/0053, 28 Oct 2026). */
export class PdfTimeoutError extends Error {
  stage: string;
  constructor(stage: string, ms: number) {
    super(`PDF timed out while ${stage} (over ${Math.round(ms / 1000)} s). Please try again.`);
    this.name = "PdfTimeoutError";
    this.stage = stage;
  }
}

export function pdfStep<T>(p: PromiseLike<T>, ms: number, stage: string): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  const timer = new Promise<never>((_, reject) => { t = setTimeout(() => reject(new PdfTimeoutError(stage, ms)), ms); });
  return Promise.race([Promise.resolve(p), timer]).finally(() => clearTimeout(t));
}

/** requestAnimationFrame that still resolves when the tab is hidden/occluded (rAF is paused there). */
export function nextFrame(fallbackMs = 120): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    try { requestAnimationFrame(finish); } catch { /* no rAF */ }
    setTimeout(finish, fallbackMs);
  });
}
