import { create } from "zustand";

/**
 * Live builder totals — populated by the in-progress builder (baskets +
 * wizard areas) so header/sidebar summaries reflect unsaved edits BEFORE
 * they hit the DB. When `hasLiveData` is false, consumers should fall back
 * to the persisted QuoteContext totals.
 */
interface QuoteLiveTotalsState {
  hasLiveData: boolean;
  items: number;
  zones: number;
  subtotal: number;
  set: (v: { items: number; zones: number; subtotal: number }) => void;
  reset: () => void;
}

export const useQuoteLiveTotals = create<QuoteLiveTotalsState>((set) => ({
  hasLiveData: false,
  items: 0,
  zones: 0,
  subtotal: 0,
  set: ({ items, zones, subtotal }) =>
    set({ hasLiveData: items > 0 || subtotal > 0, items, zones, subtotal }),
  reset: () => set({ hasLiveData: false, items: 0, zones: 0, subtotal: 0 }),
}));
