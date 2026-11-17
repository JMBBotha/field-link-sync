/**
 * Settings › All pages. Every existing staff route stays one tap away.
 * Labels prefer the live menu. Paths the menu hides still appear here.
 * Technicians do not get money pages, Create lead, or Book a job.
 */
import { v8More, v8Primary, type V8Role } from "@/components/v8/v8Nav";

export interface V8SimplePageLink { path: string; label: string }
export interface V8SimplePageGroup { title: string; links: V8SimplePageLink[] }

/** Static /admin and /field addresses (no :params, no /dev). Detail pages open from the list page. */
export const V8_SIMPLE_STAFF_PATHS = [
  "/admin",
  "/admin/yard",
  "/admin/map",
  "/admin/jobs-map",
  "/admin/dispatch",
  "/admin/requests",
  "/admin/unassigned-queue",
  "/admin/jobs",
  "/admin/jobs/dispatch",
  "/admin/my-jobs",
  "/admin/my-base",
  "/admin/my-appointments",
  "/admin/visits",
  "/admin/schedule",
  "/admin/quotes",
  "/admin/templates",
  "/admin/proposals",
  "/admin/invoices",
  "/admin/expenses",
  "/admin/bank",
  "/admin/payment-followups",
  "/admin/company-plans",
  "/admin/supplier-bills",
  "/admin/cashflow",
  "/admin/cash-health",
  "/admin/money",
  "/admin/my-commission",
  "/admin/my-signature",
  "/admin/help",
  "/admin/agreements",
  "/admin/catalog",
  "/admin/price-lists",
  "/admin/oss-extras",
  "/admin/maintenance",
  "/admin/customers",
  "/admin/projects",
  "/admin/inventory",
  "/admin/reports",
  "/admin/reports/advanced",
  "/admin/reports/aging",
  "/admin/reports/sales-by-client",
  "/admin/reports/sales-by-product",
  "/admin/reports/vat",
  "/admin/analytics",
  "/admin/notifications",
  "/admin/change-requests",
  "/admin/audit",
  "/admin/import",
  "/admin/settings",
  "/admin/team",
  "/admin/areas",
  "/admin/billing",
  "/admin/specials",
  "/admin/suppliers",
  "/admin/supplier-docs",
  "/admin/stock-count",
  "/admin/walda-approvals",
  "/admin/tools",
  "/admin/consumables",
  "/admin/whatsapp",
  "/admin/payments",
  "/admin/portal",
  "/admin/calls",
  "/admin/pdf-documents",
  "/admin/brochures",
  "/admin/unit-content",
  "/admin/companies",
  "/admin/network-agents",
  "/admin/quote-builder",
  "/admin/proposal-builder",
  "/field",
  "/field/all",
  "/field/my-jobs",
  "/field/houses",
  "/field/my-tools",
  "/field/my-base",
  "/field/schedule",
  "/field/earnings",
  "/field/quote-builder",
] as const;

const MONEY = /invoice|earning|commission|cash|bank|expense|money|payment|billing|quote-builder|price-list|catalog|supplier/i;
const TECH_BLOCKED_LABEL = /create lead|book a job|new sale/i;

function titleCase(path: string): string {
  if (path === "/admin") return "Admin home";
  if (path === "/field") return "Field today";
  const leaf = path.split("/").filter(Boolean).pop() || "Page";
  return leaf.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function groupTitle(title: string): string {
  if (title.startsWith("Platform")) return "Platform";
  return title;
}

function fromNav(role: V8Role): V8SimplePageGroup[] {
  const pinned: V8SimplePageGroup = {
    title: "Pinned today",
    links: v8Primary(role, role === "tech" ? { salary: true } : undefined).map((l) => ({ path: l.path.split("?")[0], label: l.label })),
  };
  const more = v8More(role, { cashHealth: true }).map((g) => ({
    title: groupTitle(g.title),
    links: g.links.map((l) => ({ path: l.path.split("?")[0], label: l.label })),
  }));
  return [pinned, ...more];
}

function dedupe(groups: V8SimplePageGroup[]): V8SimplePageGroup[] {
  const seen = new Set<string>();
  return groups.map((g) => ({
    title: g.title,
    links: g.links.filter((l) => {
      if (seen.has(l.path)) return false;
      seen.add(l.path);
      return true;
    }),
  })).filter((g) => g.links.length);
}

/** Admin sees every staff route. Sales sees the sales menu. Tech sees work and Me only. */
export function v8SimpleAllPages(role: "admin" | "sales" | "tech"): V8SimplePageGroup[] {
  if (role === "tech") {
    return dedupe(fromNav("tech")).map((g) => ({
      title: g.title,
      links: g.links.filter((l) => !MONEY.test(`${l.path} ${l.label}`) && !TECH_BLOCKED_LABEL.test(l.label)),
    })).filter((g) => g.links.length);
  }
  if (role === "sales") return dedupe(fromNav("sales"));
  const nav = dedupe(fromNav("admin"));
  const have = new Set(nav.flatMap((g) => g.links.map((l) => l.path)));
  const rest = V8_SIMPLE_STAFF_PATHS.filter((p) => !have.has(p)).map((path) => ({ path, label: titleCase(path) }));
  if (rest.length) nav.push({ title: "All other pages", links: rest });
  return nav;
}

export function v8SimpleAllPaths(role: "admin" | "sales" | "tech"): string[] {
  return v8SimpleAllPages(role).flatMap((g) => g.links.map((l) => l.path));
}
