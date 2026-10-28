/**
 * PDF capture helpers for product photos (Johan 28 Oct: line photos showed in the editor but not in the PDF).
 *
 * html2canvas re-requests every <img> with CORS. Hosts that send no Access-Control-Allow-Origin
 * (our own published host when the app runs on another origin, some supplier CDNs) are silently
 * dropped from the capture, and lazy offscreen images may never load at all. Before capture we
 * load every image eagerly and swap it for a same-origin data URL, so whatever shows on screen prints.
 */

const OWN_ASSET_HOSTS = ["field-link-sync.lovable.app"];

/** Our own shipped assets (e.g. https://field-link-sync.lovable.app/product-media/seed/x.png) → same-origin path. */
export function sameOriginAsset(url?: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, typeof window !== "undefined" ? window.location.href : "http://localhost/");
    if (OWN_ASSET_HOSTS.includes(u.hostname) && u.pathname.startsWith("/product-media/")) return u.pathname + u.search;
  } catch { /* leave as is */ }
  return url;
}

const blobToDataUrl = (b: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });

async function toDataUrl(src: string): Promise<string | null> {
  const tries = [src, sameOriginAsset(src)].filter((s, i, a): s is string => !!s && a.indexOf(s) === i).reverse();
  for (const s of tries) {
    try {
      const res = await fetch(s, { mode: "cors", credentials: "omit", cache: "force-cache" });
      if (!res.ok) continue;
      const blob = await res.blob();
      if (!blob.type.startsWith("image/")) continue;
      return await blobToDataUrl(blob);
    } catch { /* try next */ }
  }
  return null;
}

const loaded = (img: HTMLImageElement, ms: number) =>
  img.complete && img.naturalWidth > 0
    ? Promise.resolve()
    : Promise.race([img.decode().catch(() => undefined), new Promise((r) => setTimeout(r, ms))]);

/**
 * Inline every <img> under the given roots as a data URL (eager, CORS-safe). Images that cannot be
 * fetched are hidden for the capture instead of printing a broken-image box. Returns a restore fn.
 */
export async function inlineCaptureImages(roots: Array<Element | null | undefined>, timeoutMs = 8000): Promise<() => void> {
  const imgs = roots.flatMap((r) => (r ? Array.from(r.querySelectorAll("img")) : []));
  const undo: Array<() => void> = [];
  const cache = new Map<string, Promise<string | null>>();
  const work = Promise.all(
    imgs.map(async (img) => {
      const src = img.currentSrc || img.getAttribute("src") || "";
      if (!src || src.startsWith("data:") || src.startsWith("blob:")) return;
      if (!cache.has(src)) cache.set(src, toDataUrl(src));
      const data = await cache.get(src)!;
      if (data) {
        const prevSrc = img.getAttribute("src");
        const prevSet = img.getAttribute("srcset");
        img.removeAttribute("srcset");
        img.setAttribute("loading", "eager");
        img.src = data;
        await loaded(img, 3000);
        undo.push(() => { if (prevSrc != null) img.setAttribute("src", prevSrc); if (prevSet != null) img.setAttribute("srcset", prevSet); });
      } else {
        // Last chance: it may still render if the browser already has it same-origin; otherwise hide it.
        img.setAttribute("loading", "eager");
        await loaded(img, 2000);
        if (!(img.complete && img.naturalWidth > 0)) {
          const prev = img.style.visibility;
          img.style.visibility = "hidden";
          undo.push(() => { img.style.visibility = prev; });
        }
      }
    }),
  );
  await Promise.race([work, new Promise((r) => setTimeout(r, timeoutMs))]);
  return () => undo.forEach((f) => f());
}
