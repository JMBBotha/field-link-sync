/**
 * Read every row in pages (Supabase returns at most 1,000 rows per request by default,
 * so a single .limit(2000) / .limit(20000) silently truncates). Read-only helper.
 */
export async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
  pageSize = 1000,
  maxRows = 50000,
): Promise<{ data: T[]; error: any }> {
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1);
    if (error) return { data: out, error };
    out.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return { data: out, error: null };
}
