import type { AppRole } from "@/hooks/useRole";

/** Header line under the company name: owner (admins) plus every stored role, e.g. "owner · admin", "sales", "tech". */
export function sidebarRoleLabel(roles: AppRole[], isSalesRep: boolean): string {
  const parts: string[] = [];
  if (roles.includes("admin")) parts.push("owner", "admin");
  if (isSalesRep) parts.push("sales");
  else if (roles.includes("dispatcher")) parts.push("dispatcher");
  if (roles.includes("field_agent")) parts.push("tech");
  if (roles.includes("viewer") && parts.length === 0) parts.push("viewer");
  return parts.length ? parts.join(" · ") : "viewer";
}
