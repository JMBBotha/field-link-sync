import { create } from "zustand";

/**
 * Live builder totals — populated by the in-progress builder (baskets +
 * wizard areas) so header/sidebar summaries reflect unsaved edits BEFORE
 * they hit the DB. When `hasLiveData` is false, consumers should fall back
 * to the persisted QuoteContext totals.
 *
 * vat/total mirror the shared computeQuoteTotals maths so the builder
 * headline shows Total incl. VAT, matching the estimate page and quotes.total.
 */
interface QuoteLiveTotalsState {
  hasLiveData: boolean;
  items: number;
  zones: number;
  subtotal: number;
  vat: number;
  total: number;
  set: (v: { items: number; zones: number; subtotal: number; vat?: number; total?: number }) => void;
  reset: () => void;
}

export const useQuoteLiveTotals = create<QuoteLiveTotalsState>((set) => ({
  hasLiveData: false,
  items: 0,
  zones: 0,
  subtotal: 0,
  vat: 0,
  total: 0,
  set: ({ items, zones, subtotal, vat = 0, total = 0 }) =>
    set({ hasLiveData: true, items, zones, subtotal, vat, total }),
  reset: () => set({ hasLiveData: false, items: 0, zones: 0, subtotal: 0, vat: 0, total: 0 }),
}));
