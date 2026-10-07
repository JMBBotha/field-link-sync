/**
 * Visual PDF "Selected Items" basket, persisted per quote in localStorage
 * (key `fls.pdfBasket.<quoteId>`, or `fls.pdfBasket.draft` before the quote has an id).
 * Synced across tabs via the storage event; same-tab subscribers via a custom event.
 */
import { useCallback, useEffect, useState } from "react";
import type { PdfSelectedProduct } from "@/types/pdfSelection";

const PREFIX = "fls.pdfBasket.";
const LOCAL_EVENT = "fls-pdf-basket";
export const pdfBasketKey = (quoteId?: string | null) => `${PREFIX}${quoteId || "draft"}`;

export function readPdfBasket(quoteId?: string | null): PdfSelectedProduct[] {
  try {
    const raw = localStorage.getItem(pdfBasketKey(quoteId));
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

export function writePdfBasket(quoteId: string | null | undefined, list: PdfSelectedProduct[]) {
  const key = pdfBasketKey(quoteId);
  try {
    if (list.length) localStorage.setItem(key, JSON.stringify(list)); else localStorage.removeItem(key);
    window.dispatchEvent(new CustomEvent(LOCAL_EVENT, { detail: key }));
  } catch { /* storage full/blocked — basket stays in memory */ }
}

/** Move the draft basket onto the real quote id (only if the quote has none yet). */
export function migrateDraftPdfBasket(quoteId: string) {
  const draft = readPdfBasket(null);
  if (!draft.length) return;
  if (!readPdfBasket(quoteId).length) writePdfBasket(quoteId, draft);
  writePdfBasket(null, []);
}

/** Subscribe to a quote's basket (cross-tab + same-tab). */
export function usePdfBasket(quoteId?: string | null) {
  const key = pdfBasketKey(quoteId);
  const [list, setList] = useState<PdfSelectedProduct[]>(() => readPdfBasket(quoteId));
  useEffect(() => {
    setList(readPdfBasket(quoteId));
    const onStorage = (e: StorageEvent) => { if (e.key === key) setList(readPdfBasket(quoteId)); };
    const onLocal = (e: Event) => { if ((e as CustomEvent).detail === key) setList(readPdfBasket(quoteId)); };
    window.addEventListener("storage", onStorage);
    window.addEventListener(LOCAL_EVENT, onLocal);
    return () => { window.removeEventListener("storage", onStorage); window.removeEventListener(LOCAL_EVENT, onLocal); };
  }, [key, quoteId]);
  const save = useCallback((next: PdfSelectedProduct[]) => writePdfBasket(quoteId, next), [quoteId]);
  return [list, save] as const;
}
