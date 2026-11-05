/**
 * Columns Company Management reads from public.companies.
 * companies uses column-level SELECT grants. A column missing from that grant
 * fails the whole PostgREST select; the page must not treat that as an empty list.
 */
export const COMPANY_MANAGEMENT_SELECT =
  "id, name, slug, logo_url, status, dormant_payments_locked, created_at, updated_at, onboarding_completed, is_master, custom_service_limit, vat_rate, services";

export function rowsFromCompanyListQuery<T>(result: {
  data: T[] | null;
  error: { message: string } | null;
}): T[] {
  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}
