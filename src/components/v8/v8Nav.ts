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
  if (role === "sales") return [
    { path: "/admin", label: "Home", icon: "home" },
    { path: "/admin/jobs?tab=pipeline", label: "Pipeline", icon: "pipeline", match: ["/admin/estimates", "/admin/quote-builder", "/admin/jobs"] },
    { path: "/admin/quotes", label: "Quotes", icon: "file" },
    { path: "/admin/schedule", label: "Schedule", icon: "calendar", match: ["/admin/visits", "/admin/my-appointments"] },
    { path: "/admin/customers", label: "Clients", icon: "users" },
  ];
  return [
    { path: "/admin", label: "Home", icon: "home" },
    { path: "/admin/jobs", label: "Jobs", icon: "briefcase", match: ["/admin/jobs"] },
    { path: "/admin/invoices", label: "Invoices", icon: "wallet" },
    { path: "/admin/cash-health?tab=stock", label: "Stock", icon: "box", match: ["/admin/inventory"] },
    { path: "/admin/schedule", label: "Schedule", icon: "calendar", match: ["/admin/dispatch"] },
  ];
}

/** Phone bottom tabs stay role-appropriate (max 4 + More). The tablet sidebars follow the approved homes. Live map is never a tab. */
export function v8Tabs(role: V8Role, opts?: { salary?: boolean }): V8Link[] {
  if (role === "tech") return v8Primary(role, opts);
  if (role === "sales") return [
    { path: "/admin", label: "Home", icon: "home" },
    { path: "/admin/jobs?tab=pipeline", label: "Pipeline", icon: "pipeline", match: ["/admin/estimates", "/admin/quote-builder", "/admin/jobs"] },
    { path: "/admin/quotes", label: "Quotes", icon: "file" },
    { path: "/admin/customers", label: "Clients", icon: "users" },
  ];
  return [
    { path: "/admin", label: "Home", icon: "home" },
    { path: "/admin/jobs", label: "Jobs", icon: "briefcase" },
    { path: "/admin/invoices", label: "Invoices", icon: "wallet" },
    { path: "/admin/schedule", label: "Schedule", icon: "calendar", match: ["/admin/dispatch"] },
  ];
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
const ADMIN_ONLY = ["/admin/supplier-bills", "/admin/cashflow", "/admin/cash-health", "/admin/money", "/admin/team", "/admin/areas", "/field/earnings", "/admin/notifications", "/admin/settings", "/admin/oss-extras", "/admin/tools", "/admin/stock-count"];

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
      { path: "/field/my-tools", label: "My tools", icon: "box" },
    ] },
    me,
  ];
  if (role === "sales") return [
    { title: "Selling", links: [
      { path: "/admin/invoices", label: "Invoices", icon: "wallet" },
      { path: "/admin/visits", label: "My visits", icon: "calendar" },
      { path: "/admin/requests", label: "Requests", icon: "inbox" },
      { path: "/admin/my-appointments", label: "My appointments", icon: "calendar" },
      { path: "/admin/price-lists", label: "Price lists", icon: "book" },
    ] },
    me,
  ];
  const cash = !!opts.cashHealth;
  const groups: V8Group[] = [
    // Menu cleanup (Johan 4 Nov 21:10): same things bundled, supplier pages together, quote paperwork together. Routes unchanged.
    { title: "Jobs & requests", links: [
      { path: "/admin/jobs?tab=pipeline", label: "Pipeline", icon: "pipeline", match: ["/admin/estimates", "/admin/quote-builder"] },
      { path: "/admin/map", label: "Live map", icon: "pin", match: ["/admin/jobs-map"] },
      { path: "/admin/customers", label: "Clients", icon: "users", match: ["/admin/calls"] },
      { path: "/admin/quotes", label: "Quotes", icon: "file" },
      { path: "/admin/requests", label: "Requests", icon: "inbox" },
      { path: "/admin/unassigned-queue", label: "Unassigned queue", icon: "inbox" },
      { path: "/admin/change-requests", label: "Change requests", icon: "file" },
      { path: "/admin/maintenance", label: "Maintenance", icon: "calendar" },
      { path: "/admin/calls", label: "Calls", icon: "phone" },
      { path: "/admin/templates", label: "Templates", icon: "file", match: ["/admin/proposals"] },
      { path: "/admin/agreements", label: "Agreements", icon: "file" },
      { path: "/admin/pdf-documents", label: "Brochures & PDFs", icon: "file", match: ["/admin/brochures", "/admin/unit-content"] },
    ] },
    { title: "Money", links: [
      cash ? { path: "/admin/cash-health", label: "Cash-flow health", icon: "chart", match: ["/admin/cashflow"] }
           : { path: "/admin/cashflow", label: "Cash flow & profit", icon: "chart" },
      { path: "/admin/payment-followups", label: "Payment follow-ups", icon: "wallet" },
      { path: "/admin/expenses", label: "Expenses", icon: "wallet" },
      { path: "/admin/bank", label: "Bank (FNB)", icon: "wallet", match: ["/admin/billing"] },
      { path: "/admin/walda-approvals", label: "WALDA approvals", icon: "file" },
      { path: "/admin/money", label: "Money by lead", icon: "wallet" },
      { path: "/admin/reports", label: "Reports", icon: "chart", match: ["/admin/analytics"] },
    ] },
    { title: "Suppliers & stock", links: [
      { path: "/admin/suppliers", label: "Suppliers", icon: "building" },
      { path: "/admin/supplier-docs", label: "Supplier docs", icon: "file" },
      { path: "/admin/stock-count", label: "Stock count", icon: "box" },
      { path: "/admin/supplier-bills", label: "Supplier bills", icon: "wallet" },
      { path: "/admin/catalog", label: "Catalogue", icon: "bag", match: ["/admin/price-lists"] },
      { path: "/admin/specials", label: "Specials", icon: "tag" },
      { path: "/admin/oss-extras", label: "Extras & consumables", icon: "box", match: ["/admin/consumables"] },
      { path: "/admin/tools", label: "Company tools", icon: "box" },
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
  if (q && p === "/admin/cash-health") return (pathname === p && search.includes(q)) || !!link.match?.some((m) => pathname === m || pathname.startsWith(m + "/"));
  if (!q && p === "/admin/cash-health" && pathname === p) return !search.includes("tab=stock");
  if (p === "/admin/jobs") {
    const onHub = pathname === "/admin/jobs";
    const onJob = pathname.startsWith("/admin/jobs/");
    if (q?.includes("tab=pipeline")) {
      if (onHub && search.includes("tab=pipeline")) return true;
      if (onJob && link.match?.includes("/admin/jobs")) return true;
      return !!link.match?.some((m) => m !== "/admin/jobs" && (pathname === m || pathname.startsWith(m + "/")));
    }
    if (!q) {
      if (onJob) return true;
      if (onHub) return !search.includes("tab=pipeline") && !search.includes("tab=dispatch");
      return !!link.match?.some((m) => pathname === m || pathname.startsWith(m + "/"));
    }
  }
  const exact = p === "/admin" || p === "/field";
  if (exact ? pathname === p : (pathname === p || pathname.startsWith(p + "/"))) return true;
  return !!link.match?.some((m) => pathname === m || pathname.startsWith(m + "/"));
}
