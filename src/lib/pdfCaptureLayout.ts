/** Desktop quote/invoice sheet. Matches the off-screen PDF root (820px), not the phone viewport. */
export const PDF_CAPTURE_WIDTH_PX = 820;

/**
 * Park the node being captured in a fixed-width sheet so container queries and
 * html2canvas (which clones into an iframe the size of the window) cannot follow
 * a phone viewport. The node is put back by the returned function.
 */
export function pinPdfCaptureSheet(el: HTMLElement): () => void {
  const parent = el.parentElement;
  const next = el.nextSibling;
  const host = document.createElement("div");
  host.setAttribute("data-pdf-fixed-host", "true");
  host.setAttribute("data-pdf-a4-sheet", "true");
  host.style.cssText = `position:fixed;top:0;left:-12000px;width:${PDF_CAPTURE_WIDTH_PX}px;min-width:${PDF_CAPTURE_WIDTH_PX}px;max-width:${PDF_CAPTURE_WIDTH_PX}px;background:#fff;pointer-events:none;z-index:-1;`;

  const saved = (node: HTMLElement, prop: string) => ({
    value: node.style.getPropertyValue(prop),
    priority: node.style.getPropertyPriority(prop),
  });
  const width = saved(el, "width");
  const minWidth = saved(el, "min-width");
  const maxWidth = saved(el, "max-width");
  const htmlMax = saved(document.documentElement, "max-width");
  const bodyMax = saved(document.body, "max-width");
  const sheet = el.getAttribute("data-pdf-a4-sheet");

  const restoreProp = (node: HTMLElement, prop: string, prev: { value: string; priority: string }) => {
    if (prev.value) node.style.setProperty(prop, prev.value, prev.priority);
    else node.style.removeProperty(prop);
  };

  document.documentElement.style.setProperty("max-width", "none", "important");
  document.body.style.setProperty("max-width", "none", "important");
  document.body.appendChild(host);
  host.appendChild(el);
  el.style.setProperty("width", `${PDF_CAPTURE_WIDTH_PX}px`, "important");
  el.style.setProperty("min-width", `${PDF_CAPTURE_WIDTH_PX}px`, "important");
  el.style.setProperty("max-width", `${PDF_CAPTURE_WIDTH_PX}px`, "important");
  el.setAttribute("data-pdf-a4-sheet", "true");

  return () => {
    restoreProp(el, "width", width);
    restoreProp(el, "min-width", minWidth);
    restoreProp(el, "max-width", maxWidth);
    if (sheet == null) el.removeAttribute("data-pdf-a4-sheet");
    else el.setAttribute("data-pdf-a4-sheet", sheet);
    if (parent) parent.insertBefore(el, next);
    host.remove();
    restoreProp(document.documentElement, "max-width", htmlMax);
    restoreProp(document.body, "max-width", bodyMax);
  };
}

/** html2canvas lays the clone out in an iframe this size, so media queries see the desktop sheet. */
export function pdfCaptureWindow(el: HTMLElement): { windowWidth: number; windowHeight: number } {
  return {
    windowWidth: PDF_CAPTURE_WIDTH_PX,
    windowHeight: Math.max(el.scrollHeight, el.offsetHeight, PDF_CAPTURE_WIDTH_PX),
  };
}

/** Keep the cloned document on the desktop sheet even when the phone viewport is narrow. */
export function lockPdfClone(cloned: Document, clonedEl?: HTMLElement | null) {
  cloned.documentElement.style.setProperty("max-width", "none", "important");
  cloned.documentElement.style.setProperty("width", `${PDF_CAPTURE_WIDTH_PX}px`, "important");
  if (cloned.body) {
    cloned.body.style.setProperty("max-width", "none", "important");
    cloned.body.style.setProperty("width", `${PDF_CAPTURE_WIDTH_PX}px`, "important");
  }
  const sheet = clonedEl?.hasAttribute("data-pdf-capture-root") || clonedEl?.hasAttribute("data-pdf-a4-sheet")
    ? clonedEl
    : clonedEl?.querySelector<HTMLElement>("[data-pdf-capture-root]");
  if (!sheet) return;
  sheet.style.setProperty("width", `${PDF_CAPTURE_WIDTH_PX}px`, "important");
  sheet.style.setProperty("min-width", `${PDF_CAPTURE_WIDTH_PX}px`, "important");
  sheet.style.setProperty("max-width", `${PDF_CAPTURE_WIDTH_PX}px`, "important");
  sheet.setAttribute("data-pdf-a4-sheet", "true");
}
