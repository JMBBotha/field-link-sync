/** Field Lynk v8 Simple: pinned areas + grouped links, filtered by role. Look only — RLS and route guards stay the security. */
export type V8Role = "admin" | "owner" | "sales" | "tech";
export interface V8Link { path: string; label: string; icon: string; match?: string[] }
export interface V8Group { title: string; links: V8Link[] }

export function v8RoleOf(r: { isAdmin: boolean; isDispatcher: boolean; isFieldAgent: boolean; isSalesRep: boolean; isMainCo: boolean }): V8Role {
  if (r.isFieldAgent && !r.isAdmin && !r.isDispatcher) return "tech";
  if (r.isSalesRep && !r.isAdmin) return "sales";
  return r.isMainCo ? "admin" : "owner";
}

export function v8Primary(role: V8Role, opts?: { salary?: boolean }): V8Link[] {
  if (role === "tech") return [
    { path: "/field", label: "Today", icon: "home", match: ["/field/jobs"] },
    { path: "/field/schedule", label: "Schedule", icon: "calendar" },
    { path: "/field/earnings", label: "Earnings", icon: "wallet" },
  ].filter((l) => !(opts?.salary && l.path === "/field/earnings"));
  // Quotes + Invoices pinned for management AND sales (Johan 19 Oct 08:49). Sales see only their own rows (RLS rh_rep_scope / quote scope).
  if (role === "sales") return [
    { path: "/admin", label: "Home", icon: "home" },
    { path: "/admin/jobs?tab=pipeline", label: "My pipeline", icon: "pipeline", match: ["/admin/jobs", "/admin/estimates", "/admin/quote-builder"] },
    { path: "/admin/visits", label: "My visits", icon: "calendar", match: ["/admin/my-appointments"] },
    { path: "/admin/customers", label: "Clients", icon: "users" },
    { path: "/admin/quotes", label: "Quotes", icon: "file" },
    { path: "/admin/invoices", label: "Invoices", icon: "wallet" },
  ];
  return [
    { path: "/admin", label: "Home", icon: "home" },
    { path: "/admin/jobs?tab=pipeline", label: "Pipeline", icon: "pipeline", match: ["/admin/jobs", "/admin/estimates", "/admin/quote-builder"] },
    { path: "/admin/schedule", label: "Schedule", icon: "calendar", match: ["/admin/dispatch"] },
    { path: "/admin/customers", label: "Clients", icon: "users", match: ["/admin/calls"] },
    { path: "/admin/quotes", label: "Quotes", icon: "file" },
    { path: "/admin/invoices", label: "Invoices", icon: "wallet" },
  ];
}

/** Phone bottom tabs: max 4 + More. Quotes/Invoices sit at the top of the More drawer (pinned list) on phones. */
export function v8Tabs(role: V8Role, opts?: { salary?: boolean }): V8Link[] {
  return v8Primary(role, opts).filter((l) => l.label !== "Quotes" && l.label !== "Invoices").slice(0, 4);
}

/** Personal links: name-card menu for admin/owner (Johan 19 Oct). */
export function v8Me(role: V8Role): V8Link[] {
  if (role === "tech") return [{ path: "/field/my-base", label: "My base", icon: "pin" }];
  return [
    { path: "/admin/my-base", label: "My base", icon: "pin" },
    { path: "/admin/my-commission", label: "My commission", icon: "wallet" },
    { path: "/admin/my-signature", label: "My signature", icon: "pen" },
  ];
}

export interface V8NavOpts { cashHealth?: boolean; manager?: boolean }
/** Admin-only routes (RequireRole ["admin"] / owner): hidden from managers (dispatchers). Route guards stay the security. */
const ADMIN_ONLY = ["/admin/supplier-bills", "/admin/cashflow", "/admin/cash-health", "/admin/money", "/admin/team", "/admin/areas", "/field/earnings", "/admin/notifications", "/admin/settings", "/admin/oss-extras"];

/** Everything else, so every page stays one click away. Admin/owner: 4-5 collapsible groups. */
export function v8More(role: V8Role, opts: V8NavOpts = {}): V8Group[] {
  const me: V8Group = { title: "Settings & me", links: [
    ...v8Me(role),
    { path: "/admin/notifications", label: "Notifications", icon: "bell" },
    { path: "/admin/help", label: "Help", icon: "help" },
  ] };
  if (role === "tech") return [
    { title: "Work", links: [
      { path: "/admin/my-jobs", label: "Job offers", icon: "briefcase", match: ["/field/my-jobs"] },
      { path: "/field/all", label: "Full field view", icon: "home" },
    ] },
    me,
  ];
  if (role === "sales") return [
    { title: "Selling", links: [
      { path: "/admin/my-appointments", label: "My appointments", icon: "calendar" },
      { path: "/admin/price-lists", label: "Price lists", icon: "book" },
    ] },
    me,
  ];
  const cash = !!opts.cashHealth;
  const groups: V8Group[] = [
    { title: "Work", links: [
      { path: "/admin/unassigned-queue", label: "Unassigned queue", icon: "inbox" },
      { path: "/admin/templates", label: "Templates", icon: "file" },
      { path: "/admin/agreements", label: "Agreements", icon: "file" },
      { path: "/admin/change-requests", label: "Change requests", icon: "file" },
      { path: "/admin/maintenance", label: "Maintenance", icon: "calendar" },
      { path: "/admin/map", label: "Live tracking", icon: "pin", match: ["/admin/jobs-map"] },
      { path: "/admin/calls", label: "Calls", icon: "phone" },
    ] },
    { title: "Money", links: [
      cash ? { path: "/admin/cash-health", label: "Cash-flow health", icon: "chart", match: ["/admin/cashflow"] }
           : { path: "/admin/cashflow", label: "Cash flow & profit", icon: "chart" },
      { path: "/admin/payment-followups", label: "Payment follow-ups", icon: "wallet" },
      { path: "/admin/expenses", label: "Expenses", icon: "wallet" },
      { path: "/admin/supplier-bills", label: "Supplier bills", icon: "wallet" },
      { path: "/admin/bank", label: "Bank (FNB)", icon: "wallet", match: ["/admin/billing"] },
      { path: "/admin/money", label: "Money by lead", icon: "wallet" },
      { path: "/admin/reports", label: "Reports", icon: "chart", match: ["/admin/analytics"] },
    ] },
    { title: "Catalogue & stock", links: [
      { path: "/admin/catalog", label: "Catalogue", icon: "bag", match: ["/admin/price-lists"] },
      { path: cash ? "/admin/cash-health?tab=stock" : "/admin/inventory", label: "Stock", icon: "box", match: ["/admin/inventory"] },
      { path: "/admin/suppliers", label: "Suppliers", icon: "building" },
      { path: "/admin/specials", label: "Specials", icon: "tag" },
      { path: "/admin/oss-extras", label: "Extras & consumables", icon: "box", match: ["/admin/consumables"] },
      { path: "/admin/pdf-documents", label: "Documents", icon: "file", match: ["/admin/brochures", "/admin/unit-content"] },
    ] },
    { title: "Team & settings", links: [
      { path: "/admin/team", label: "Team", icon: "users", match: ["/admin/network-agents"] },
      { path: "/admin/areas", label: "Areas", icon: "pin" },
      { path: "/field/earnings", label: "Tech earnings", icon: "wallet" },
      { path: "/admin/time-tracking", label: "Time tracking", icon: "calendar" },
      { path: "/admin/notifications", label: "Notifications", icon: "bell" },
      { path: "/admin/settings", label: "Settings", icon: "settings" },
      { path: "/admin/help", label: "Help", icon: "help" },
    ] },
  ];
  if (opts.manager) for (const g of groups) g.links = g.links.filter((l) => !ADMIN_ONLY.includes(l.path.split("?")[0]));
  if (opts.manager) return groups.filter((g) => g.links.length);
  if (role === "admin") groups.push({ title: "Platform (Massair)", links: [
    { path: "/admin/companies", label: "Companies", icon: "building" },
    { path: "/admin/company-plans", label: "Company plans", icon: "wallet" },
    { path: "/admin/audit", label: "Audit log", icon: "file" },
    { path: "/admin/import", label: "Import", icon: "upload" },
    { path: "/admin/reports/advanced", label: "Advanced reports", icon: "chart" },
    { path: "/field", label: "Field agent view", icon: "users" },
  ] });
  return groups;
}

export function v8IsActive(link: V8Link, pathname: string, search = ""): boolean {
  const [p, q] = link.path.split("?");
  if (p === "/admin/schedule" && pathname === "/admin/jobs") return search.includes("tab=dispatch");
  if (q && p === "/admin/cash-health") return (pathname === p && search.includes(q)) || !!link.match?.some((m) => pathname === m);
  if (!q && p === "/admin/cash-health" && pathname === p) return !search.includes("tab=stock");
  const exact = p === "/admin" || p === "/field";
  if (exact ? pathname === p : (pathname === p || pathname.startsWith(p + "/"))) {
    if (q && p === "/admin/jobs") return !search.includes("tab=dispatch");
    return true;
  }
  return !!link.match?.some((m) => pathname === m || pathname.startsWith(m + "/"));
}
