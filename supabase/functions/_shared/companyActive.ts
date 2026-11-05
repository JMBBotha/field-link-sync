/** True only when companies.status is active. Unknown id or a read error fails closed. */

export async function companyIsActive(
  sb: { from: (table: string) => any },
  companyId: string | null | undefined,
): Promise<boolean> {
  if (!companyId) return true;
  const { data, error } = await sb.from("companies").select("status").eq("id", companyId).maybeSingle();
  if (error || !data) return false;
  return (data.status || "active") === "active";
}
