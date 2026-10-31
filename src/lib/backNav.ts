/** Back arrow rules (Johan 31 Oct): hidden on the root tabs, otherwise go back one step,
 *  or to the parent route when there is no in-app history (deep link / fresh tab). */
const ROOTS = new Set(["/admin", "/admin/jobs", "/admin/visits", "/admin/customers", "/admin/schedule", "/admin/dispatch",
  "/field", "/field/schedule", "/field/earnings", "/field/my-jobs"]);

const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

export function isRootPath(pathname: string): boolean {
  const p = norm(pathname);
  if (ROOTS.has(p)) return true;
  if (/^\/client\/[^/]+(\/dashboard)?$/.test(p)) return true; // client workspace home
  if (/^\/customer\/[^/]+$/.test(p)) return true; // customer portal home
  return false;
}

/** Parent route used when there is nothing to go back to. */
export function parentPath(pathname: string): string {
  const p = norm(pathname);
  const special: [RegExp, string][] = [
    [/^\/admin\/(estimates|quote-builder)(\/|$)/, "/admin/quotes"],
    [/^\/admin\/invoices\/.+/, "/admin/invoices"],
    [/^\/admin\/customers\/.+/, "/admin/customers"],
    [/^\/admin\/jobs\/.+/, "/admin/jobs?tab=pipeline"],
    [/^\/field\/.+/, "/field"],
  ];
  for (const [re, to] of special) if (re.test(p)) return to;
  const parts = p.split("/").filter(Boolean);
  if (parts.length <= 1) return "/admin";
  if (parts[0] === "client" && parts.length > 2) return `/client/${parts[1]}`;
  if (parts[0] === "customer" && parts.length > 2) return `/customer/${parts[1]}`;
  return "/" + parts.slice(0, -1).join("/");
}

/** react-router stores the history index in history.state.idx; 0 = first page of this tab. */
export function hasInAppHistory(): boolean {
  const idx = (typeof window !== "undefined" && (window.history.state as any)?.idx) as number | undefined;
  return typeof idx === "number" && idx > 0;
}
