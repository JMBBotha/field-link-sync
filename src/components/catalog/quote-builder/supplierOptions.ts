const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PageRowLite { supplier_id: string | null; pdf_upload_id?: string | null; pdf_filename?: string | null; page_number?: number | null }

/** Live page counts per supplier: skips inactive uploads, dedupes like the pages query. */
export function countLivePages(rows: PageRowLite[], inactiveIds: Set<string>): Record<string, number> {
  const seen = new Set<string>();
  const counts: Record<string, number> = {};
  for (const r of rows) {
    if (!r.supplier_id || !r.supplier_id.trim()) continue;
    if (r.pdf_upload_id && inactiveIds.has(r.pdf_upload_id)) continue;
    const key = `${r.supplier_id}|${r.pdf_filename}|${r.page_number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    counts[r.supplier_id] = (counts[r.supplier_id] || 0) + 1;
  }
  return counts;
}

export interface SupplierOption { value: string; label: string; count: number }

/** Trimmed, A-Z options with live page counts; 0-page and unnamed (UUID) suppliers hidden. */
export function buildSupplierOptions(ids: string[], names: Record<string, string>, counts: Record<string, number>): SupplierOption[] {
  return ids
    .map((s) => ({ value: s, label: String(names[s] || s).trim(), count: counts[s] || 0 }))
    .filter((o) => o.label && o.count > 0 && !UUID_PATTERN.test(o.label))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Saved choice is kept only if it is still a listed supplier. */
export function resolveSavedSupplier(saved: string | null | undefined, options: SupplierOption[]): string {
  if (!saved || saved === "all") return "all";
  return options.some((o) => o.value === saved) ? saved : "all";
}
