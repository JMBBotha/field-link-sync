/** Bundle capacity range definition */
export interface CapacityBundle {
  id: string;
  name: string;
  minBtu: number;
  maxBtu: number;
  lines: Array<{ productId: string; quantity: number }>;
}

/** Lightweight reference used before DB bundles are loaded */
export interface BundleRange {
  label: string;
  minBtu: number;
  maxBtu: number;
}
