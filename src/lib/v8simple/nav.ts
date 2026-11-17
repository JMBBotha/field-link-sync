/** V8 simple tabs. One set per role. Tech never gets Book a job or Create lead. */
import { ADMIN_HOME_ROUTES } from "@/lib/roleHome";

export type V8SimpleRole = "admin" | "sales" | "tech";

export interface V8SimpleTab {
  id: "home" | "jobs" | "schedule" | "clients" | "me";
  label: string;
  /** Path under /v8. Home is the index. */
  segment: "" | "jobs" | "schedule" | "clients" | "me";
}

const TECH: V8SimpleTab[] = [
  { id: "home", label: "Today", segment: "" },
  { id: "schedule", label: "Schedule", segment: "schedule" },
  { id: "me", label: "Me", segment: "me" },
];

const SALES: V8SimpleTab[] = [
  { id: "home", label: "Home", segment: "" },
  { id: "jobs", label: "Jobs", segment: "jobs" },
  { id: "clients", label: "Clients", segment: "clients" },
  { id: "schedule", label: "Schedule", segment: "schedule" },
];

const ADMIN: V8SimpleTab[] = [
  { id: "home", label: "Home", segment: "" },
  { id: "jobs", label: "Jobs", segment: "jobs" },
  { id: "schedule", label: "Schedule", segment: "schedule" },
  { id: "clients", label: "Clients", segment: "clients" },
];

export function v8SimpleTabs(role: V8SimpleRole): V8SimpleTab[] {
  if (role === "tech") return TECH;
  if (role === "sales") return SALES;
  return ADMIN;
}

/** Sales and admin book work. Technicians do not. */
export function v8SimpleShowsBookJob(role: V8SimpleRole): boolean {
  return role !== "tech";
}

/** Existing Book a job front door. The preview does not invent a second one. */
export const V8_SIMPLE_BOOK_JOB = ADMIN_HOME_ROUTES.bookJob;

export function v8SimpleTabPath(root: string, tab: V8SimpleTab): string {
  const base = root.replace(/\/$/, "") || "/v8";
  return tab.segment ? `${base}/${tab.segment}` : base;
}

export function v8SimpleRoleFromQuery(value: string | null | undefined): V8SimpleRole | null {
  if (value === "admin" || value === "sales" || value === "tech") return value;
  return null;
}
