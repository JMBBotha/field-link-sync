import { pipePairFromText } from "@/lib/kitSizes";

/**
 * Pipe-size lock carry-over for imports (mirrored in
 * supabase/functions/parse-price-list/pipeLock.ts — keep in sync).
 * Manual rows (pipe_sizes_manual=true) are looked up INCLUDING archived ones,
 * matched by normalised code within one supplier, brand-scoped where known.
 */
export interface ManualPipeRow {
  id?: string;
  product_code: string | null;
  brand?: string | null;
  pipe_size?: string | null;
  pipe_liquid?: string | null;
  pipe_gas?: string | null;
}

export function normPipeCode(code: string | null | undefined): string {
  return String(code ?? "").toLowerCase().trim().replace(/~hist.*$/, "").replace(/\s+/g, "");
}

const normBrand = (b: string | null | undefined) => String(b ?? "").trim().toLowerCase();

export function buildManualIndex(rows: ManualPipeRow[]): Map<string, ManualPipeRow[]> {
  const m = new Map<string, ManualPipeRow[]>();
  for (const r of rows || []) {
    const k = normPipeCode(r.product_code);
    if (!k) continue;
    m.set(k, [...(m.get(k) || []), r]);
  }
  return m;
}

export function findManual(index: Map<string, ManualPipeRow[]>, code: string, brand?: string | null): ManualPipeRow | null {
  const list = index.get(normPipeCode(code)) || [];
  if (!list.length) return null;
  const b = normBrand(brand);
  if (!b) return list[0];
  return list.find((r) => normBrand(r.brand) === b) || list.find((r) => !normBrand(r.brand)) || null;
}

export function resolvePipeCols(
  index: Map<string, ManualPipeRow[]>,
  code: string,
  text: string | null | undefined,
  brand?: string | null,
): { pipe_size: string | null; pipe_liquid: string | null; pipe_gas: string | null; pipe_sizes_manual?: true } {
  const m = findManual(index, code, brand);
  if (m) {
    return { pipe_size: m.pipe_size ?? null, pipe_liquid: m.pipe_liquid ?? null, pipe_gas: m.pipe_gas ?? null, pipe_sizes_manual: true };
  }
  const pair = pipePairFromText(text);
  return { pipe_size: text ?? null, pipe_liquid: pair?.liquid ?? null, pipe_gas: pair?.gas ?? null };
}
