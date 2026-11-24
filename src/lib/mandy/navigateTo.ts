/**
 * navigate_to — spoken or typed intents → a real router path.
 * Routes come from the App.tsx index. Role gates are the route's own guards.
 * Spoken text and the audit payload carry the page name or document number only.
 * Client names stay on the on-screen pick list (this app), not in the sentence
 * Mandy speaks and not in the audit data. No new third party is called.
 */
import type { MandyResult } from "./actions";
import {
  followRedirect,
  isSafeAppRoute,
  matchRoute,
  roleAllows,
  techOnly,
  type IndexedRoute,
  type NavActor,
} from "./routeIndex";

export type { NavActor };

export type NavEntity = "quote" | "invoice" | "client" | "job";

export interface NavHit {
  id: string;
  entity: NavEntity;
  reference: string | null;
  /** Button label only. May name a client so the person can tell rows apart. */
  chip: string;
}

export interface NavSearch {
  search(entity: NavEntity, query: string): Promise<NavHit[]>;
}

export interface NavCtx {
  actor: NavActor;
  routes: IndexedRoute[];
  search: NavSearch;
}

export type NavOutcome =
  | { kind: "go"; route: string; label: string; say: string; pageId?: string; entity?: NavEntity; recordId?: string; reference?: string | null }
  | { kind: "choose"; say: string; entity: NavEntity; choices: { id: string; chip: string; reference: string | null }[] }
  | { kind: "deny"; say: string; label: string }
  | { kind: "miss"; say: string }
  | { kind: "ask"; say: string };

const WORD: Record<NavEntity, string> = { quote: "quote", invoice: "invoice", client: "client", job: "job" };
const PLURAL: Record<NavEntity, string> = { quote: "quotes", invoice: "invoices", client: "clients", job: "jobs" };

type PageId =
  | "dashboard" | "leads" | "pipeline" | "quotes" | "invoices" | "jobs" | "my-jobs"
  | "dispatch" | "calendar" | "clients" | "stock" | "stock-count" | "reports" | "analytics"
  | "team" | "settings" | "yard" | "map" | "catalogue" | "suppliers" | "help" | "expenses"
  | "agreements" | "visits" | "appointments" | "requests" | "notifications" | "companies"
  | "audit" | "earnings" | "money" | "cash-health" | "cashflow" | "quote-builder" | "unassigned";

const PAGES: Record<PageId, { label: string; path: (a: NavActor) => string; useDenyRedirect?: boolean }> = {
  dashboard: { label: "Dashboard", path: (a) => (techOnly(a) ? "/field" : "/admin") },
  leads: { label: "Leads", path: (a) => (a.salesRep ? "/admin/jobs?tab=pipeline" : "/admin/dispatch?inbox=1") },
  pipeline: { label: "Pipeline", path: () => "/admin/jobs?tab=pipeline" },
  quotes: { label: "Quotes", path: () => "/admin/quotes" },
  invoices: { label: "Invoices", path: () => "/admin/invoices" },
  jobs: { label: "Jobs", path: () => "/admin/jobs", useDenyRedirect: true },
  "my-jobs": { label: "My jobs", path: (a) => (techOnly(a) ? "/field/my-jobs" : "/admin/my-jobs") },
  dispatch: { label: "Dispatch", path: () => "/admin/dispatch" },
  calendar: {
    label: "Schedule",
    path: (a) => (techOnly(a) ? "/field/schedule" : a.salesRep ? "/admin/my-appointments" : "/admin/schedule"),
  },
  clients: { label: "Clients", path: () => "/admin/customers" },
  stock: { label: "Stock", path: () => "/admin/inventory" },
  "stock-count": { label: "Stock count", path: () => "/admin/stock-count" },
  reports: { label: "Reports", path: () => "/admin/reports" },
  analytics: { label: "Analytics", path: () => "/admin/analytics" },
  team: { label: "Team", path: () => "/admin/team" },
  settings: { label: "Settings", path: () => "/admin/settings" },
  yard: { label: "Yard", path: () => "/admin/yard" },
  map: { label: "Map", path: () => "/admin/map" },
  catalogue: { label: "Catalogue", path: () => "/admin/catalog" },
  suppliers: { label: "Suppliers", path: () => "/admin/suppliers" },
  help: { label: "Help", path: () => "/admin/help" },
  expenses: { label: "Expenses", path: () => "/admin/expenses" },
  agreements: { label: "Agreements", path: () => "/admin/agreements" },
  visits: { label: "Visits", path: () => "/admin/visits" },
  appointments: { label: "My appointments", path: () => "/admin/my-appointments" },
  requests: { label: "Requests", path: () => "/admin/requests" },
  notifications: { label: "Notifications", path: () => "/admin/notifications" },
  companies: { label: "Companies", path: () => "/admin/companies" },
  audit: { label: "Audit log", path: () => "/admin/audit" },
  earnings: { label: "Earnings", path: () => "/field/earnings" },
  money: { label: "Money", path: () => "/admin/money" },
  "cash-health": { label: "Cash-flow health", path: () => "/admin/cash-health" },
  cashflow: { label: "Cash flow", path: () => "/admin/cashflow" },
  "quote-builder": { label: "Quote builder", path: () => "/admin/quote-builder" },
  unassigned: { label: "Unassigned queue", path: () => "/admin/unassigned-queue" },
};

const PHRASES: [string, PageId][] = [
  ["dispatch calendar", "dispatch"],
  ["unassigned queue", "unassigned"],
  ["cash-flow health", "cash-health"],
  ["cash flow health", "cash-health"],
  ["cash-flow", "cashflow"],
  ["cash flow", "cashflow"],
  ["cash health", "cash-health"],
  ["service agreements", "agreements"],
  ["quote builder", "quote-builder"],
  ["price lists", "catalogue"],
  ["price list", "catalogue"],
  ["stock count", "stock-count"],
  ["my appointments", "appointments"],
  ["my earnings", "earnings"],
  ["my visits", "visits"],
  ["new leads", "leads"],
  ["lead inbox", "leads"],
  ["jobs map", "map"],
  ["job map", "map"],
  ["live map", "map"],
  ["yard view", "yard"],
  ["quote list", "quotes"],
  ["invoice list", "invoices"],
  ["client list", "clients"],
  ["customer list", "clients"],
  ["job offers", "my-jobs"],
  ["my jobs", "my-jobs"],
  ["audit log", "audit"],
  ["dashboard", "dashboard"],
  ["home", "dashboard"],
  ["today", "dashboard"],
  ["leads", "leads"],
  ["inbox", "leads"],
  ["pipeline", "pipeline"],
  ["quotes", "quotes"],
  ["estimates", "quotes"],
  ["invoices", "invoices"],
  ["jobs", "jobs"],
  ["dispatch", "dispatch"],
  ["calendar", "calendar"],
  ["schedule", "calendar"],
  ["diary", "calendar"],
  ["clients", "clients"],
  ["customers", "clients"],
  ["stock", "stock"],
  ["inventory", "stock"],
  ["reports", "reports"],
  ["report", "reports"],
  ["analytics", "analytics"],
  ["team", "team"],
  ["staff", "team"],
  ["settings", "settings"],
  ["setting", "settings"],
  ["yard", "yard"],
  ["map", "map"],
  ["catalogue", "catalogue"],
  ["catalog", "catalogue"],
  ["suppliers", "suppliers"],
  ["supplier", "suppliers"],
  ["help", "help"],
  ["expenses", "expenses"],
  ["agreements", "agreements"],
  ["visits", "visits"],
  ["appointments", "appointments"],
  ["requests", "requests"],
  ["notifications", "notifications"],
  ["companies", "companies"],
  ["audit", "audit"],
  ["earnings", "earnings"],
  ["money", "money"],
  ["cashflow", "cashflow"],
  ["unassigned", "unassigned"],
];
PHRASES.sort((a, b) => b[0].length - a[0].length);

const NAV_LEAD = /^(?:please\s+)?(?:can you\s+|could you\s+|would you\s+)?(?:i\s+(?:want|need)\s+(?:you\s+)?to\s+)?(?:open|show(?:\s+me)?|go(?:\s+to)?|take me to|pull up|navigate to|switch to|bring up)\s+(?:the\s+|my\s+|our\s+|a\s+)?([\s\S]+?)\s*[.!]?\s*$/i;

export type ParsedNav =
  | { kind: "page"; pageId: string }
  | { kind: "record"; entity: NavEntity; query: string }
  | { kind: "unknown" };

export function canonicalQuoteNumber(raw: string): string | null {
  const m = raw.match(/\bQ[\s-]*(\d{4})[\s-]*(\d{2,6})\b/i);
  if (!m) return null;
  return `Q-${m[1]}-${m[2].padStart(4, "0")}`;
}

export function canonicalInvoiceNumber(raw: string): string | null {
  const m = raw.match(/\bINV[\s-]*(\d{2,8})\b/i);
  if (!m) return null;
  return `INV-${m[1]}`;
}

function normalizePhrase(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function matchPage(phrase: string): PageId | null {
  const hit = PHRASES.find(([p]) => p === phrase);
  return hit ? hit[1] : null;
}

const ENTITY_WORD: Record<string, NavEntity> = {
  quote: "quote", quotes: "quote", estimate: "quote", estimates: "quote",
  invoice: "invoice", invoices: "invoice",
  client: "client", clients: "client", customer: "client", customers: "client",
  job: "job", jobs: "job",
};

function entityOf(value: unknown): NavEntity | null {
  const key = String(value ?? "").toLowerCase().trim();
  return ENTITY_WORD[key] ?? null;
}

/** Clear navigation only. Quote edits, totals and "the last quote" stay with their own tools. */
export function parseNavigateUtterance(text: string): ParsedNav | null {
  const raw = String(text || "").trim();
  if (!raw || /\band\b/i.test(raw)) return null;
  const m = raw.match(NAV_LEAD);
  if (!m) return null;
  let norm = normalizePhrase(m[1]);
  norm = norm.replace(/^(?:the|my|our|a)\s+/, "").trim();
  if (!norm) return null;
  if (/\b(photos?|pictures?|images?|brochures?|overdue|unpaid)\b/i.test(norm)) return null;
  if (/^(last|latest|top|recent|newest)(?:\s+(?:quote|estimate|one))?$/.test(norm)) return null;
  if (/^today'?s?\s+jobs?$/.test(norm)) return null;

  const page = matchPage(norm) || matchPage(norm.replace(/\b(page|screen|tab|section)\b/g, " ").replace(/\s+/g, " ").trim());
  const quoteNo = canonicalQuoteNumber(raw);
  const invNo = canonicalInvoiceNumber(raw);
  if (page && !quoteNo && !invNo) return { kind: "page", pageId: page };
  if (quoteNo) return { kind: "record", entity: "quote", query: quoteNo };
  if (invNo) return { kind: "record", entity: "invoice", query: invNo };

  const record = recordFromWords(norm);
  if (record) return record;
  if (page) return { kind: "page", pageId: page };
  if (/^[a-z][a-z' .-]{1,60}$/i.test(norm) && !/\b(add|set|remove|change|make|delete|send|pay|total|deposit|labour|labor|note|price|kit)\b/i.test(norm)) {
    return { kind: "record", entity: "client", query: m[1].trim().replace(/[.!?]+$/, "") };
  }
  if (/^(?:open|go|take me to|pull up|navigate to|switch to|bring up)\b/i.test(raw)) return { kind: "unknown" };
  return null;
}

function recordFromWords(norm: string): ParsedNav | null {
  const stop = /^(list|page|screen|total|totals|deposit|one|it|that)$/i;
  let m = norm.match(/^(.+?)'s\s+(quote|estimate|invoice|job|client|customer)s?$/);
  if (m && !stop.test(m[1])) return { kind: "record", entity: ENTITY_WORD[m[2]], query: m[1] };
  m = norm.match(/^(quote|estimate|invoice|job|client|customer)s?\s+(?:for|named|called)\s+(.+)$/);
  if (m && !stop.test(m[2])) return { kind: "record", entity: ENTITY_WORD[m[1]], query: m[2] };
  m = norm.match(/^(quote|estimate|invoice|job|client|customer)s?\s+(.+)$/);
  if (m && !stop.test(m[2]) && !matchPage(`${m[1]} ${m[2]}`) && !matchPage(m[2])) {
    return { kind: "record", entity: ENTITY_WORD[m[1]], query: m[2] };
  }
  m = norm.match(/^(.+?)\s+(quote|estimate|invoice)s?$/);
  if (m && !stop.test(m[1]) && !matchPage(norm) && !matchPage(m[1])) return { kind: "record", entity: ENTITY_WORD[m[2]], query: m[1] };
  if (/^(quote|estimate|invoice|client|customer|job)s?$/.test(norm)) {
    return { kind: "record", entity: ENTITY_WORD[norm.replace(/s$/, "")] ?? ENTITY_WORD[norm], query: "" };
  }
  return null;
}

function labelFor(pageId: string, route: string, actor: NavActor): string {
  const [path, q = ""] = route.split("?");
  const spec = PAGES[pageId as PageId];
  if (pageId === "dashboard" && path === "/field") return "Today";
  if (path === "/admin/my-jobs" || path === "/field/my-jobs") return "My jobs";
  if (path === "/admin/requests" && (pageId === "dispatch" || pageId === "leads")) return "Requests";
  if (path === "/admin/my-appointments") return "My appointments";
  if (q.includes("tab=pipeline")) return "Pipeline";
  if (path === "/admin/cash-health" && q.includes("tab=stock")) return "Stock";
  if (path === "/field/schedule" || path === "/admin/schedule") return "Schedule";
  return spec?.label || "that page";
}

function go(route: string, label: string, extra: { pageId?: string } = {}): NavOutcome {
  return { kind: "go", route, label, say: `Opening ${label}.`, ...extra };
}

export function resolvePage(pageId: string, actor: NavActor, routes: IndexedRoute[]): NavOutcome {
  const spec = PAGES[pageId as PageId];
  if (!spec) return { kind: "miss", say: "I can't open that page." };
  const start = spec.path(actor);
  const startRoute = matchRoute(start.split("?")[0], routes);
  if (!startRoute) return { kind: "miss", say: "I can't open that page." };
  const pureRedirect = !!(startRoute.redirectKind || startRoute.staticRedirect);
  if (!pureRedirect) {
    const access = roleAllows(startRoute, actor);
    if ("reason" in access) {
      if (access.reason === "owner" && actor.companyOwner === null) {
        return { kind: "ask", say: "I'm still checking whether you can open Money. Say it again in a moment." };
      }
      if (spec.useDenyRedirect && access.reason === "role" && startRoute.redirectOnDeny && startRoute.redirectTo) {
        const dest = startRoute.redirectTo;
        const destRoute = matchRoute(dest.split("?")[0], routes);
        if (destRoute && roleAllows(destRoute, actor).ok && isSafeAppRoute(dest)) {
          return go(dest, labelFor(pageId, dest, actor), { pageId });
        }
      }
      return { kind: "deny", say: `You can't open ${spec.label}.`, label: spec.label };
    }
  }
  let landed = followRedirect(start, actor, routes);
  const second = followRedirect(landed, actor, routes);
  if (second !== landed) landed = second;
  const landedPath = landed.split("?")[0];
  const landedRoute = matchRoute(landedPath, routes);
  if (!landedRoute || !isSafeAppRoute(landed.split("#")[0])) {
    return { kind: "miss", say: "I can't open that page." };
  }
  if (!roleAllows(landedRoute, actor).ok) return { kind: "deny", say: `You can't open ${spec.label}.`, label: spec.label };
  return go(landed, labelFor(pageId, landed, actor), { pageId });
}

function recordPath(entity: NavEntity, id: string, actor: NavActor): string | null {
  if (!/^[0-9a-f-]{8,64}$/i.test(id) || id.includes("--")) return null;
  if (entity === "quote") return `/admin/estimates/${id}`;
  if (entity === "invoice") return `/admin/invoices/${id}`;
  if (entity === "client") return `/admin/customers/${id}`;
  if (entity === "job") return techOnly(actor) ? `/field/jobs/${id}` : `/admin/jobs/${id}`;
  return null;
}

function permitRecord(entity: NavEntity, id: string, actor: NavActor, routes: IndexedRoute[]): NavOutcome {
  const route = recordPath(entity, id, actor);
  const word = WORD[entity];
  if (!route || !isSafeAppRoute(route)) return { kind: "miss", say: `I can't open that ${word}.` };
  const indexed = matchRoute(route, routes);
  if (!indexed || !roleAllows(indexed, actor).ok) return { kind: "deny", say: `You can't open that ${word}.`, label: word };
  return { kind: "go", route, label: word, say: `Opening that ${word}.`, entity, recordId: id, reference: null };
}

function compactRef(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

function chooseHits(hits: NavHit[], query: string, entity: NavEntity): NavHit[] {
  const want = entity === "quote" ? canonicalQuoteNumber(query) : entity === "invoice" ? canonicalInvoiceNumber(query) : null;
  if (!want) return hits.slice(0, 6);
  const exact = hits.filter((h) => h.reference && compactRef(h.reference) === compactRef(want));
  return (exact.length ? exact : hits).slice(0, 6);
}

async function openSearch(entity: NavEntity, query: string, ctx: NavCtx): Promise<NavOutcome> {
  const q = query.trim();
  const word = WORD[entity];
  if (!q) return { kind: "ask", say: `Which ${word}? Say a number or a name.` };
  let hits: NavHit[] = [];
  try {
    hits = await ctx.search.search(entity, q);
  } catch {
    return { kind: "miss", say: "I couldn't look that up." };
  }
  const rows = chooseHits(hits, q, entity);
  if (!rows.length) {
    const ref = entity === "quote" ? canonicalQuoteNumber(q) : entity === "invoice" ? canonicalInvoiceNumber(q) : null;
    return { kind: "miss", say: ref ? `I couldn't find ${ref}.` : `I couldn't find that ${word}.` };
  }
  if (rows.length > 1) {
    return {
      kind: "choose",
      say: `Several ${PLURAL[entity]} match. Tap one in the chat panel.`,
      entity,
      choices: rows.map((h) => ({ id: h.id, chip: h.chip || h.reference || "Match", reference: h.reference })),
    };
  }
  const hit = rows[0];
  const opened = permitRecord(entity, hit.id, ctx.actor, ctx.routes);
  if (opened.kind !== "go") return opened;
  const ref = hit.reference;
  return {
    ...opened,
    reference: ref,
    label: ref || opened.label,
    say: ref ? `Opening ${word} ${ref}.` : `Opening that ${word}.`,
  };
}

export async function resolveNavigation(args: Record<string, unknown>, ctx: NavCtx): Promise<NavOutcome> {
  if (!ctx.actor.ready) return { kind: "ask", say: "I'm still checking what you can open. Say it again in a moment." };
  const entityArg = entityOf(args.entity);
  const recordId = typeof args.record_id === "string" ? args.record_id : "";
  if (entityArg && recordId) {
    const opened = permitRecord(entityArg, recordId, ctx.actor, ctx.routes);
    if (opened.kind === "go") {
      const ref = typeof args.reference === "string" ? canonicalQuoteNumber(args.reference) || canonicalInvoiceNumber(args.reference) : null;
      return ref ? { ...opened, reference: ref, say: `Opening ${WORD[entityArg]} ${ref}.` } : opened;
    }
    return opened;
  }
  const utterance = typeof args.utterance === "string" ? args.utterance : "";
  const parsed = utterance ? parseNavigateUtterance(utterance) : null;
  if (parsed?.kind === "unknown") return { kind: "miss", say: "I can't open that page." };
  if (parsed?.kind === "page") return resolvePage(parsed.pageId, ctx.actor, ctx.routes);
  if (parsed?.kind === "record") return openSearch(parsed.entity, parsed.query, ctx);
  const pageTok = typeof args.page === "string" ? matchPage(normalizePhrase(args.page)) : null;
  if (pageTok) return resolvePage(pageTok, ctx.actor, ctx.routes);
  const query = [args.query, args.ref, args.client].find((v) => typeof v === "string" && String(v).trim()) as string | undefined;
  if (entityArg && query) return openSearch(entityArg, query, ctx);
  if (entityArg) return { kind: "ask", say: `Which ${WORD[entityArg]}? Say a number or a name.` };
  return { kind: "ask", say: "Where should I open? Say a page, or a quote or invoice number." };
}

/** Fields written to nl_audit_log. No client name, phone, email or address. */
export function navAuditData(outcome: Extract<NavOutcome, { kind: "go" }>): Record<string, unknown> {
  return {
    route: outcome.route,
    page: outcome.label,
    entity: outcome.entity ?? null,
    record_id: outcome.recordId ?? null,
    reference: outcome.reference ?? null,
  };
}

export async function runNavigateTo(args: Record<string, unknown>, ctx: NavCtx & { go: (path: string) => void }): Promise<MandyResult> {
  const outcome = await resolveNavigation(args, ctx);
  if (outcome.kind === "go") {
    if (!isSafeAppRoute(outcome.route)) return { ok: false, message: "I can't open that page." };
    ctx.go(outcome.route);
    return { ok: true, message: outcome.say, data: navAuditData(outcome) };
  }
  if (outcome.kind === "choose") {
    return {
      ok: true,
      message: outcome.say,
      choices: outcome.choices.map((c) => ({
        label: c.chip,
        action: "navigate_to",
        args: {
          entity: outcome.entity,
          record_id: c.id,
          ...(c.reference ? { reference: c.reference } : {}),
        },
      })),
    };
  }
  return { ok: false, message: outcome.say };
}
