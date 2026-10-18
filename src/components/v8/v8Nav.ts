/** Field Lynk v8 Simple: 6 areas + More, filtered by role. Look only — RLS and route guards stay the security. */
export type V8Role = "admin" | "owner" | "sales" | "tech";
export interface V8Link { path: string; label: string; icon: string; match?: string[] }
export interface V8Group { title: string; links: V8Link[] }

export function v8RoleOf(r: { isAdmin: boolean; isDispatcher: boolean; isFieldAgent: boolean; isSalesRep: boolean; isMainCo: boolean }): V8Role {
  if (r.isFieldAgent && !r.isAdmin && !r.isDispatcher) return "tech";
  if (r.isSalesRep && !r.isAdmin) return "sales";
  return r.isMainCo ? "admin" : "owner";
}

export function v8Primary(role: V8Role): V8Link[] {
  if (role === "tech") return [
    { path: "/field", label: "Today", icon: "home", match: ["/field/jobs"] },
    { path: "/field/schedule", label: "Schedule", icon: "calendar" },
    { path: "/field/earnings", label: "Earnings", icon: "wallet" },
  ];
  if (role === "sales") return [
    { path: "/admin", label: "Home", icon: "home" },
    { path: "/admin/jobs?tab=pipeline", label: "My pipeline", icon: "pipeline", match: ["/admin/jobs", "/admin/quotes", "/admin/estimates", "/admin/quote-builder"] },
    { path: "/admin/visits", label: "My visits", icon: "calendar", match: ["/admin/my-appointments"] },
    { path: "/admin/customers", label: "Clients", icon: "users" },
  ];
  return [
    { path: "/admin", label: "Home", icon: "home" },
    { path: "/admin/jobs?tab=pipeline", label: "Pipeline", icon: "pipeline", match: ["/admin/jobs", "/admin/quotes", "/admin/estimates", "/admin/quote-builder", "/admin/templates", "/admin/agreements", "/admin/change-requests"] },
    { path: "/admin/schedule", label: "Schedule", icon: "calendar", match: ["/admin/maintenance", "/admin/map", "/admin/jobs-map"] },
    { path: "/admin/customers", label: "Clients", icon: "users", match: ["/admin/calls"] },
    { path: "/admin/invoices", label: "Money", icon: "wallet", match: ["/admin/expenses", "/admin/bank", "/admin/money", "/admin/billing", "/admin/payments", "/admin/payment-followups", "/admin/supplier-bills", "/admin/cashflow"] },
  ];
}

/** Everything else, so every page stays one click from More. */
export function v8More(role: V8Role): V8Group[] {
  const me: V8Group = { title: "Settings & me", links: [
    ...(role === "tech" ? [{ path: "/field/my-base", label: "My base", icon: "pin" }] : [{ path: "/admin/my-base", label: "My base", icon: "pin" }]),
    ...(role === "tech" ? [] : [{ path: "/admin/my-commission", label: "My commission", icon: "wallet" }, { path: "/admin/my-signature", label: "My signature", icon: "pen" }]),
    { path: "/admin/notifications", label: "Notifications", icon: "bell" },
    { path: "/admin/help", label: "Help", icon: "help" },
    ...(role === "admin" || role === "owner" ? [{ path: "/admin/settings", label: "Settings", icon: "settings" }] : []),
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
      { path: "/admin/quotes", label: "Quotes list", icon: "file" },
    ] },
    me,
  ];
  const groups: V8Group[] = [
    { title: "Leads & work", links: [
      { path: "/admin/dispatch", label: "New leads inbox", icon: "inbox" },
      { path: "/admin/unassigned-queue", label: "Unassigned queue", icon: "inbox" },
      { path: "/admin/jobs?tab=dispatch", label: "Dispatch", icon: "briefcase" },
      { path: "/admin/quotes", label: "Quotes list", icon: "file" },
      { path: "/admin/templates", label: "Templates", icon: "file" },
      { path: "/admin/agreements", label: "Agreements", icon: "file" },
      { path: "/admin/change-requests", label: "Change requests", icon: "file" },
      { path: "/admin/maintenance", label: "Maintenance", icon: "calendar" },
      { path: "/admin/map", label: "Live tracking", icon: "pin" },
      { path: "/admin/calls", label: "Calls", icon: "phone" },
    ] },
    { title: "Money", links: [
      { path: "/admin/invoices", label: "Invoices", icon: "file" },
      { path: "/admin/payments", label: "Payments", icon: "wallet" },
      { path: "/admin/payment-followups", label: "Payment follow-ups", icon: "wallet" },
      { path: "/admin/expenses", label: "Expenses", icon: "wallet" },
      { path: "/admin/supplier-bills", label: "Supplier bills", icon: "wallet" },
      { path: "/admin/bank", label: "Bank (FNB)", icon: "wallet" },
      { path: "/admin/cashflow", label: "Cash flow & profit", icon: "chart" },
      { path: "/admin/money", label: "Owner", icon: "wallet" },
    ] },
    { title: "Catalogue", links: [
      { path: "/admin/catalog", label: "Catalogue", icon: "bag" },
      { path: "/admin/price-lists", label: "Price lists", icon: "book" },
      { path: "/admin/inventory", label: "Stock", icon: "box" },
      { path: "/admin/suppliers", label: "Suppliers", icon: "building" },
      { path: "/admin/specials", label: "Specials", icon: "tag" },
      { path: "/admin/consumables", label: "Consumables", icon: "box" },
      { path: "/admin/oss-extras", label: "OSS extras", icon: "box" },
      { path: "/admin/pdf-documents", label: "PDF documents", icon: "file" },
      { path: "/admin/brochures", label: "Brochures", icon: "file" },
      { path: "/admin/unit-content", label: "Unit content", icon: "file" },
    ] },
    { title: "Team", links: [
      { path: "/admin/team", label: "Team", icon: "users" },
      { path: "/admin/network-agents", label: "Network agents", icon: "users" },
      { path: "/admin/areas", label: "Areas", icon: "pin" },
      { path: "/field/earnings", label: "Tech earnings", icon: "wallet" },
      { path: "/admin/time-tracking", label: "Time tracking", icon: "calendar" },
    ] },
    { title: "Reports", links: [
      { path: "/admin/reports", label: "Reports", icon: "chart" },
      { path: "/admin/reports/aging", label: "Accounts ageing", icon: "chart" },
      { path: "/admin/reports/sales-by-client", label: "Sales by client", icon: "chart" },
      { path: "/admin/reports/sales-by-product", label: "Sales by product", icon: "chart" },
      { path: "/admin/reports/vat", label: "VAT report", icon: "chart" },
      { path: "/admin/analytics", label: "Analytics", icon: "chart" },
    ] },
    { title: "Projects & more", links: [
      { path: "/admin/projects", label: "Projects", icon: "briefcase" },
      { path: "/admin/whatsapp", label: "WhatsApp", icon: "phone" },
      { path: "/admin/portal", label: "Customer portal", icon: "users" },
    ] },
    me,
  ];
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
  const exact = p === "/admin" || p === "/field";
  if (exact ? pathname === p : (pathname === p || pathname.startsWith(p + "/"))) {
    if (q && p === "/admin/jobs") return !search.includes("tab=dispatch");
    return true;
  }
  return !!link.match?.some((m) => pathname === m || pathname.startsWith(m + "/"));
}
