/**
 * Unified Quote Types — single source of truth for all three builders.
 * Maps directly to the quote_areas and quote_items Supabase tables.
 */
import type { UnitType } from "@/lib/pricingUnits";


export interface QuoteArea {
  id: string;
  quote_id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface QuoteItem {
  id: string;
  quote_id: string;
  area_id: string | null;
  parent_item_id: string | null;
  product_id: string | null;
  item_name: string;
  item_number: string | null;
  description: string | null;
  quantity: number;
  length: number | null;
  unit_price: number;
  total_price: number | null;
  is_bundle: boolean;
  item_type: string | null;
  metadata: Record<string, any>;
  sort_order: number;
  notes: string | null;
  source: string;
  supplier: string | null;
  /** Unit-based pricing (see src/lib/pricingUnits.ts) */
  unit_type?: UnitType;
  price_per_unit_qty?: number;
  price_per_unit_label?: string;
  allows_decimal_qty?: boolean;
  qty_step?: number;
  min_qty?: number;
  created_at: string;
  updated_at: string;
}


export interface QuoteMeta {
  id: string;
  quote_number: string;
  customer_id: string | null;
  customer_name: string | null;
  status: string;
  subtotal: number;
  vat_rate: number;
  vat_amount: number;
  total: number;
  notes: string | null;
  valid_until: string | null;
  discount_type: string | null;
  discount_value: number | null;
  terms_text: string | null;
  reference_text: string | null;
}

/** Full quote with joined areas and items */
export interface FullQuote {
  meta: QuoteMeta;
  areas: QuoteArea[];
  /** All items (top-level and bundle children), sorted by sort_order */
  items: QuoteItem[];
}

/** Payload for creating/updating an item */
export type QuoteItemInsert = Omit<QuoteItem, "id" | "created_at" | "updated_at"> & { id?: string };
export type QuoteItemUpdate = Partial<Omit<QuoteItem, "id" | "created_at" | "updated_at">>;

/** Payload for creating/updating an area */
export type QuoteAreaInsert = Omit<QuoteArea, "id" | "created_at" | "updated_at"> & { id?: string };
export type QuoteAreaUpdate = Partial<Omit<QuoteArea, "id" | "created_at" | "updated_at">>;
