export type TierLineUnit = "qty" | "m";

export interface TierLineConfig {
  productCode: string;
  defaultQty: number;
  unit: TierLineUnit;
}

export interface BundleTierConfig {
  name: string;
  lines: TierLineConfig[];
}

export interface CapacityTierConfig {
  capacityLabel: string;
  minBtu: number;
  maxBtu: number;
  tiers: BundleTierConfig[];
}

export const CAPACITY_TIER_CONFIGS: CapacityTierConfig[] = [
  {
    capacityLabel: "9K",
    minBtu: 8000,
    maxBtu: 10000,
    tiers: [
      {
        name: "Piping & Insulation",
        lines: [
          { productCode: "COPRL001", defaultQty: 5, unit: "m" },
          { productCode: "IT009", defaultQty: 5, unit: "m" },
        ],
      },
      {
        name: "Drain, Trunking & Bracket",
        lines: [
          { productCode: "BRAC01", defaultQty: 1, unit: "qty" },
          { productCode: "TAPE006", defaultQty: 1, unit: "qty" },
        ],
      },
      {
        name: "Fixings & Sundries",
        lines: [
          { productCode: "EASYD", defaultQty: 1, unit: "qty" },
          { productCode: "CAT003", defaultQty: 1, unit: "qty" },
        ],
      },
    ],
  },
  {
    capacityLabel: "24K",
    minBtu: 22000,
    maxBtu: 26000,
    tiers: [
      {
        name: "Piping & Insulation",
        lines: [
          { productCode: "COPRL002", defaultQty: 8, unit: "m" },
          { productCode: "IT010", defaultQty: 8, unit: "m" },
        ],
      },
      {
        name: "Drain, Trunking & Bracket",
        lines: [
          { productCode: "BRAC02", defaultQty: 1, unit: "qty" },
          { productCode: "TAPE006", defaultQty: 1, unit: "qty" },
        ],
      },
      {
        name: "Fixings & Sundries",
        lines: [
          { productCode: "EASYD", defaultQty: 1, unit: "qty" },
          { productCode: "CAT003", defaultQty: 1, unit: "qty" },
        ],
      },
    ],
  },
];

export function findTierConfigForBtu(btu: number): CapacityTierConfig | null {
  return CAPACITY_TIER_CONFIGS.find((c) => btu >= c.minBtu && btu <= c.maxBtu) || null;
}
