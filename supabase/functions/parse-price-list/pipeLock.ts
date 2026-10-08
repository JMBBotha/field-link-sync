// Mirror of src/lib/pipeLockCarry.ts (edge functions can't import src/).
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
