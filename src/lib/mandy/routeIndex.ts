/**
 * Route index generated from App.tsx (the router), not a second hand-written map.
 * Mandy may only open a path this index contains, and only when the same
 * RequireRole / sales-rep / owner gates on that route would allow it.
 */
import { salesHomeFor } from "@/components/SalesRepFieldRedirect";

export interface IndexedRoute {
  path: string;
  /** null = any signed-in user. Empty array = nobody (fail closed). */
  allowedRoles: string[] | null;
  denySalesRep: boolean;
  platformOwner: boolean;
  companyOwner: boolean;
  redirectTo: string | null;
  redirectOnDeny: boolean;
  salesRepRedirect: boolean;
  redirectKind: "dispatch-calendar" | "jobs-dispatch" | null;
  staticRedirect: string | null;
}

export interface NavActor {
  ready: boolean;
  roles: string[];
  salesRep: boolean;
  platformOwner: boolean;
  /** null while the company-owner check is still loading. */
  companyOwner: boolean | null;
}

export function techOnly(actor: NavActor): boolean {
  return actor.roles.includes("field_agent") && !actor.roles.includes("admin") && !actor.roles.includes("dispatcher");
}

export function stripSourceComments(source: string): string {
  let out = "";
  let i = 0;
  let quote: '"' | "'" | "`" | null = null;
  while (i < source.length) {
    const c = source[i];
    const n = source[i + 1];
    if (quote) {
      out += c;
      if (c === "\\") {
        out += n ?? "";
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      i++;
      continue;
    }
    if (c === "/" && n === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && n === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      out += " ";
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function joinPath(parent: string, pathAttr: string | null, isIndex: boolean): string | null {
  if (isIndex) return parent || "/";
  if (!pathAttr) return null;
  if (pathAttr.startsWith("/")) return pathAttr.replace(/\/+$/, "") || "/";
  const base = parent.endsWith("/") ? parent.slice(0, -1) : parent;
  return `${base}/${pathAttr}`.replace(/\/{2,}/g, "/");
}

function readRoles(attrs: string): string[] | null {
  const m = attrs.match(/allowedRoles=\{\s*\[([^\]]*)\]/);
  if (!m) return null;
  return [...m[1].matchAll(/["']([a-z_]+)["']/g)].map((x) => x[1]);
}

function routeFrom(path: string, attrs: string): IndexedRoute {
  const hasRole = /<RequireRole\b/.test(attrs);
  const parsedRoles = readRoles(attrs);
  const staticRedirect = attrs.match(/<Navigate\b[^>]*\bto="([^"]+)"/)?.[1] ?? null;
  let redirectKind: IndexedRoute["redirectKind"] = null;
  if (/\bDispatchCalendarRedirect\b/.test(attrs)) redirectKind = "dispatch-calendar";
  else if (/\bJobsDispatchRedirect\b/.test(attrs)) redirectKind = "jobs-dispatch";
  return {
    path,
    allowedRoles: hasRole ? (parsedRoles ?? []) : null,
    denySalesRep: /\bdenySalesRep\b/.test(attrs),
    platformOwner: /<RequirePlatformOwner\b/.test(attrs),
    companyOwner: /<RequireOwner\b/.test(attrs),
    redirectTo: attrs.match(/\bredirectTo="([^"]+)"/)?.[1] ?? null,
    redirectOnDeny: /\bredirectOnDeny\b/.test(attrs),
    salesRepRedirect: /<SalesRepFieldRedirect\b/.test(attrs),
    redirectKind,
    staticRedirect,
  };
}

function readTag(src: string, start: number): { end: number; selfClosing: boolean; attrs: string } | null {
  if (!src.startsWith("<Route", start) || /[A-Za-z]/.test(src[start + 6] ?? "")) return null;
  let i = start + 6;
  let brace = 0;
  let quote: string | null = null;
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "{") { brace++; continue; }
    if (c === "}") { brace = Math.max(0, brace - 1); continue; }
    if (c === ">" && brace === 0) {
      return { end: i + 1, selfClosing: src[i - 1] === "/", attrs: src.slice(start, i + 1) };
    }
  }
  return null;
}

function findClose(src: string, from: number): number {
  let depth = 1;
  let i = from;
  while (i < src.length && depth > 0) {
    const open = src.indexOf("<Route", i);
    const close = src.indexOf("</Route", i);
    if (close < 0) return src.length;
    if (open >= 0 && open < close && src[open + 6] && !/[A-Za-z]/.test(src[open + 6])) {
      const tag = readTag(src, open);
      if (!tag) { i = open + 6; continue; }
      if (!tag.selfClosing) depth++;
      i = tag.end;
      continue;
    }
    depth--;
    if (depth === 0) return close;
    const gt = src.indexOf(">", close);
    i = gt < 0 ? close + 7 : gt + 1;
  }
  return i;
}

function parseRegion(src: string, start: number, end: number, parent: string, out: IndexedRoute[]) {
  let i = start;
  while (i < end) {
    const open = src.indexOf("<Route", i);
    if (open < 0 || open >= end) break;
    if (/[A-Za-z]/.test(src[open + 6] ?? " ")) { i = open + 6; continue; }
    const tag = readTag(src, open);
    if (!tag) { i = open + 6; continue; }
    const pathAttr = tag.attrs.match(/\bpath="([^"]*)"/)?.[1] ?? null;
    const isIndex = /\bindex\b/.test(tag.attrs);
    const full = joinPath(parent, pathAttr, isIndex);
    if (full) out.push(routeFrom(full, tag.attrs));
    if (tag.selfClosing) {
      i = tag.end;
      continue;
    }
    const close = findClose(src, tag.end);
    parseRegion(src, tag.end, Math.min(close, src.length), full || parent, out);
    const gt = src.indexOf(">", close);
    i = gt < 0 ? close + 8 : gt + 1;
  }
}

/** Every <Route> in the router source, with the guards written on that route. */
export function indexAppRoutes(source: string): IndexedRoute[] {
  const src = stripSourceComments(source);
  const out: IndexedRoute[] = [];
  parseRegion(src, 0, src.length, "", out);
  return out;
}

function restrictionScore(route: IndexedRoute): number {
  return (route.allowedRoles ? 4 : 0) + (route.denySalesRep ? 2 : 0) + (route.platformOwner ? 2 : 0)
    + (route.companyOwner ? 2 : 0) + (route.salesRepRedirect ? 1 : 0);
}

export function matchRoute(pathname: string, routes: IndexedRoute[]): IndexedRoute | null {
  const path = (pathname.split("?")[0] || "/").replace(/\/+$/, "") || "/";
  let best: IndexedRoute | null = null;
  let bestScore = -1;
  for (const route of routes) {
    const pattern = route.path.split("/").map((seg) => (seg.startsWith(":") ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).join("/");
    if (!new RegExp(`^${pattern}$`).test(path)) continue;
    const score = route.path.split("/").filter(Boolean).reduce((s, seg) => s + (seg.startsWith(":") ? 1 : 3), 0);
    if (!best || score > bestScore || (score === bestScore && restrictionScore(route) > restrictionScore(best))) {
      best = route;
      bestScore = score;
    }
  }
  return best;
}

export type AccessDeny = "role" | "sales" | "platform" | "owner";

/** Same decision RequireRole / RequireOwner / RequirePlatformOwner / SalesRepFieldRedirect would make. */
export function roleAllows(route: IndexedRoute, actor: NavActor): { ok: true } | { ok: false; reason: AccessDeny } {
  if (route.platformOwner && !actor.platformOwner) return { ok: false, reason: "platform" };
  if (route.companyOwner && actor.companyOwner !== true) return { ok: false, reason: "owner" };
  if (route.allowedRoles && !route.allowedRoles.some((r) => actor.roles.includes(r))) return { ok: false, reason: "role" };
  if (route.denySalesRep && actor.salesRep) return { ok: false, reason: "sales" };
  if (route.salesRepRedirect && actor.salesRep) return { ok: false, reason: "sales" };
  return { ok: true };
}

/** One hop of the router's own redirects (dispatch calendar, inventory, sales /field). */
export function followRedirect(path: string, actor: NavActor, routes: IndexedRoute[]): string {
  const [pathname, search = ""] = path.split("?");
  const route = matchRoute(pathname, routes);
  if (!route) return path;
  if (route.redirectKind === "dispatch-calendar") {
    if (actor.salesRep) {
      const lead = new URLSearchParams(search).get("lead");
      return lead ? `/admin?myjob=${encodeURIComponent(lead)}` : "/admin/requests";
    }
    const p = new URLSearchParams(search);
    p.set("tab", "dispatch");
    p.set("view", "calendar");
    const q = p.toString();
    return `/admin/jobs${q ? `?${q}` : ""}`;
  }
  if (route.redirectKind === "jobs-dispatch") {
    const p = new URLSearchParams(search);
    p.set("tab", "dispatch");
    if (!p.get("view") || p.get("view") === "stages") p.set("view", "board");
    return `/admin/jobs?${p.toString()}`;
  }
  if (route.staticRedirect) return route.staticRedirect;
  if (route.salesRepRedirect && actor.salesRep) return salesHomeFor(pathname, search ? `?${search}` : "");
  return path;
}

export function isSafeAppRoute(route: string): boolean {
  if (route.includes("..") || route.includes("//") || route.includes("\\") || /[\s<>]/.test(route)) return false;
  return /^\/(?:admin|field)(?:\/[A-Za-z0-9_-]+)*(?:\?[A-Za-z0-9_.=&%-]*)?$/.test(route);
}
