/** Snapshot of a quote's non-labour lines, used to spot edits made outside the builder. */
export interface QuoteLineStamp { ids: Set<string>; maxUpdatedAt: string | null }

const ts = (s: string | null | undefined) => (s ? Date.parse(s) || 0 : 0);

export function stampFromRows(rows: { id: string; updated_at?: string | null }[]): QuoteLineStamp {
  let max: string | null = null;
  for (const r of rows) if (r.updated_at && ts(r.updated_at) > ts(max)) max = r.updated_at;
  return { ids: new Set(rows.map((r) => r.id)), maxUpdatedAt: max };
}

export function mergeStamps(a: QuoteLineStamp, b: QuoteLineStamp): QuoteLineStamp {
  return { ids: new Set([...a.ids, ...b.ids]), maxUpdatedAt: ts(b.maxUpdatedAt) > ts(a.maxUpdatedAt) ? b.maxUpdatedAt : a.maxUpdatedAt };
}

/** True when `current` has a line the builder never saw, or a line edited after the baseline. */
export function stampChanged(baseline: QuoteLineStamp, current: QuoteLineStamp): boolean {
  for (const id of current.ids) if (!baseline.ids.has(id)) return true;
  return ts(current.maxUpdatedAt) > ts(baseline.maxUpdatedAt);
}
