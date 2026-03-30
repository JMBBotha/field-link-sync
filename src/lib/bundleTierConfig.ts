/**
 * 3-Tier Installation Bundle Configuration
 *
 * Each BTU capacity gets 3 tiers of materials auto-added when an AC unit is
 * dropped into a zone. Tiers reference product_codes in supplier_products.
 *
 * Tier 1 — Piping & Electrical: copper pair coil, interconnect/communication cable
 * Tier 2 — Drain, Trunking & Bracket: PVC drain pipe, trunking, bracket, tape, cover
 * Tier 3 — Additional Electrical: isolator, breaker, cable clips, nails, earth rod, conduit
 *
 * To edit: update the arrays below. Products are matched by product_code at runtime.
 */

export interface TierLine {
  /** product_code in supplier_products */
  productCode: string;
  /** default quantity (for unit items) */
  quantity: number;
  /** default length in metres (for length items — overrides quantity) */
  lengthMetres?: number;
}

export interface BundleTier {
  tier: 1 | 2 | 3;
  label: string;
  lines: TierLine[];
}

export interface CapacityTierConfig {
  capacityLabel: string;   // "9K", "12K", etc.
  minBtu: number;
  maxBtu: number;
  tiers: BundleTier[];
}

// ─── Pipe size mapping per capacity ───
// 9K/12K: 1/4" + 3/8"  |  18K: 1/4" + 1/2"  |  24K: 3/8" + 5/8"  |  36K: 3/8" + 3/4"

const TIER_1_PIPING_9K: TierLine[] = [
  { productCode: "COPRL001", quantity: 1, lengthMetres: 5 },   // 1/4" copper
  { productCode: "COPRL002", quantity: 1, lengthMetres: 5 },   // 3/8" copper
  { productCode: "IT009",    quantity: 1, lengthMetres: 6 },   // 1/4" insulation
  { productCode: "IT010",    quantity: 1, lengthMetres: 6 },   // 3/8" insulation
];

const TIER_1_PIPING_12K: TierLine[] = [
  { productCode: "COPRL001", quantity: 1, lengthMetres: 5 },
  { productCode: "COPRL002", quantity: 1, lengthMetres: 5 },
  { productCode: "IT009",    quantity: 1, lengthMetres: 6 },
  { productCode: "IT010",    quantity: 1, lengthMetres: 6 },
];

const TIER_1_PIPING_18K: TierLine[] = [
  { productCode: "COPRL001", quantity: 1, lengthMetres: 6 },   // 1/4"
  { productCode: "COPRL003", quantity: 1, lengthMetres: 6 },   // 1/2"
  { productCode: "IT009",    quantity: 1, lengthMetres: 7 },
  { productCode: "IT010",    quantity: 1, lengthMetres: 7 },
];

const TIER_1_PIPING_24K: TierLine[] = [
  { productCode: "COPRL002", quantity: 1, lengthMetres: 8 },   // 3/8"
  { productCode: "COPRL004", quantity: 1, lengthMetres: 8 },   // 5/8"
  { productCode: "IT009",    quantity: 1, lengthMetres: 9 },
  { productCode: "IT010",    quantity: 1, lengthMetres: 9 },
];

const TIER_1_PIPING_36K: TierLine[] = [
  { productCode: "COPRL002", quantity: 1, lengthMetres: 10 },  // 3/8"
  { productCode: "COPRL005", quantity: 1, lengthMetres: 10 },  // 3/4"
  { productCode: "IT009",    quantity: 1, lengthMetres: 11 },
  { productCode: "IT010",    quantity: 1, lengthMetres: 11 },
];

// ─── Tier 2: Drain, Trunking & Bracket ───
const TIER_2_SMALL: TierLine[] = [
  { productCode: "DPIPE01",  quantity: 1, lengthMetres: 5 },   // PVC drain pipe
  { productCode: "TRUNK03",  quantity: 1, lengthMetres: 5 },   // 40x40 trunking
  { productCode: "BRAC01",   quantity: 1 },                     // 450mm bracket set
  { productCode: "TAPE006",  quantity: 1, lengthMetres: 5 },   // tape
  { productCode: "COUPL001", quantity: 2 },                     // PVC couplings
  { productCode: "ELB001",   quantity: 2 },                     // PVC elbows
];

const TIER_2_MEDIUM: TierLine[] = [
  { productCode: "DPIPE01",  quantity: 1, lengthMetres: 6 },
  { productCode: "TRUNK03",  quantity: 1, lengthMetres: 6 },
  { productCode: "BRAC02",   quantity: 1 },                     // 550mm bracket set
  { productCode: "TAPE006",  quantity: 1, lengthMetres: 6 },
  { productCode: "COUPL001", quantity: 2 },
  { productCode: "ELB001",   quantity: 2 },
];

const TIER_2_LARGE: TierLine[] = [
  { productCode: "DPIPE01",  quantity: 1, lengthMetres: 8 },
  { productCode: "TRUNK01",  quantity: 1, lengthMetres: 8 },   // 100x40 trunking
  { productCode: "BRAC05",   quantity: 1 },                     // 650mm bracket set
  { productCode: "TAPE006",  quantity: 1, lengthMetres: 8 },
  { productCode: "COUPL001", quantity: 3 },
  { productCode: "ELB001",   quantity: 3 },
];

// ─── Tier 3: Additional Electrical ───
const TIER_3_SMALL: TierLine[] = [
  { productCode: "EASYD",    quantity: 1 },                     // knock-in nails box
  { productCode: "CAT003",   quantity: 1 },                     // cable ties
  { productCode: "GLUE03",   quantity: 1 },                     // PVC weld
];

const TIER_3_LARGE: TierLine[] = [
  { productCode: "EASYD",    quantity: 1 },
  { productCode: "CAT003",   quantity: 1 },
  { productCode: "GLUE03",   quantity: 1 },
];

// ─── Full capacity configs ───
export const CAPACITY_TIER_CONFIGS: CapacityTierConfig[] = [
  {
    capacityLabel: "9K",
    minBtu: 8000,
    maxBtu: 10000,
    tiers: [
      { tier: 1, label: "Piping & Insulation", lines: TIER_1_PIPING_9K },
      { tier: 2, label: "Drain, Trunking & Bracket", lines: TIER_2_SMALL },
      { tier: 3, label: "Fixings & Sundries", lines: TIER_3_SMALL },
    ],
  },
  {
    capacityLabel: "12K",
    minBtu: 11000,
    maxBtu: 13000,
    tiers: [
      { tier: 1, label: "Piping & Insulation", lines: TIER_1_PIPING_12K },
      { tier: 2, label: "Drain, Trunking & Bracket", lines: TIER_2_SMALL },
      { tier: 3, label: "Fixings & Sundries", lines: TIER_3_SMALL },
    ],
  },
  {
    capacityLabel: "18K",
    minBtu: 17000,
    maxBtu: 19000,
    tiers: [
      { tier: 1, label: "Piping & Insulation", lines: TIER_1_PIPING_18K },
      { tier: 2, label: "Drain, Trunking & Bracket", lines: TIER_2_MEDIUM },
      { tier: 3, label: "Fixings & Sundries", lines: TIER_3_SMALL },
    ],
  },
  {
    capacityLabel: "24K",
    minBtu: 22000,
    maxBtu: 26000,
    tiers: [
      { tier: 1, label: "Piping & Insulation", lines: TIER_1_PIPING_24K },
      { tier: 2, label: "Drain, Trunking & Bracket", lines: TIER_2_MEDIUM },
      { tier: 3, label: "Fixings & Sundries", lines: TIER_3_LARGE },
    ],
  },
  {
    capacityLabel: "36K",
    minBtu: 34000,
    maxBtu: 38000,
    tiers: [
      { tier: 1, label: "Piping & Insulation", lines: TIER_1_PIPING_36K },
      { tier: 2, label: "Drain, Trunking & Bracket", lines: TIER_2_LARGE },
      { tier: 3, label: "Fixings & Sundries", lines: TIER_3_LARGE },
    ],
  },
];

/**
 * Find the matching capacity tier config for a BTU value.
 */
export function findTierConfigForBtu(btu: number): CapacityTierConfig | null {
  return CAPACITY_TIER_CONFIGS.find((c) => btu >= c.minBtu && btu <= c.maxBtu) || null;
}
