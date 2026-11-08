/** Presentation helpers for the approved role homes. Counting stays in adminHomeCount / materialCheck. */
import type { CountFigure } from "@/lib/adminHomeCount";
import { formatRand } from "@/utils/formatRand";

export const PIE_DEPOSIT = "#7CC7F7";
export const PIE_FINAL = "#83D9B5";
export const PIE_WAITING = "#FFBD92";

export interface CashSlice {
  key: "deposit" | "final" | "waiting";
  label: string;
  total: number;
  display: string;
  colour: string;
  figure: CountFigure;
}

/** Same definitions as the admin-home money figures: deposit balance, final balance, drafts not emailed. */
export function cashProjectionSlices(figures: { deposit: CountFigure; finalDue: CountFigure; waiting: CountFigure }): CashSlice[] {
  return [
    { key: "deposit", label: "Deposits due", total: figures.deposit.total, display: formatRand(figures.deposit.total), colour: PIE_DEPOSIT, figure: figures.deposit },
    { key: "final", label: "Finals due", total: figures.finalDue.total, display: formatRand(figures.finalDue.total), colour: PIE_FINAL, figure: figures.finalDue },
    { key: "waiting", label: "Waiting to send", total: figures.waiting.total, display: formatRand(figures.waiting.total), colour: PIE_WAITING, figure: figures.waiting },
  ];
}

/** Hour in Africa/Johannesburg, 0–23. The phone's local zone is not the calendar. */
export function johannesburgHour(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Johannesburg",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const raw = parts.find((p) => p.type === "hour")?.value ?? "0";
  return Number(raw) % 24;
}

export function greetingTitle(now: Date, name?: string | null): string {
  const h = johannesburgHour(now);
  const hello = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const first = (name || "").trim().split(/\s+/)[0];
  return first ? `${hello}, ${first}` : hello;
}

/** Where Admin Home controls go. Review opens the draft list; it does not send. */
export const ADMIN_HOME_ROUTES = {
  reviewSend: "/admin/invoices?state=draft",
  jobs: "/admin/jobs",
  bookJob: "/admin/jobs?new=1",
  map: "/admin/map",
  stock: "/admin/cash-health?tab=stock",
  cash: "/admin/cash-health",
  yard: "/admin/yard",
  job: (id: string) => `/admin/jobs/${id}`,
} as const;

/** SATURDAY, 07 NOV — Johannesburg calendar day. */
export function greetingEyebrow(now: Date): string {
  const weekday = now.toLocaleDateString("en-GB", { weekday: "long", timeZone: "Africa/Johannesburg" }).toUpperCase();
  const day = now.toLocaleDateString("en-GB", { day: "2-digit", timeZone: "Africa/Johannesburg" });
  const month = now.toLocaleDateString("en-GB", { month: "short", timeZone: "Africa/Johannesburg" }).toUpperCase();
  return `${weekday}, ${day} ${month}`;
}

/** Suburb from a street address. Does not invent a place when the address has none. */
export function areaFromAddress(address?: string | null, title?: string | null): string {
  const parts = (address || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 3) return parts[parts.length - 2];
  if (parts.length === 2) return parts[1];
  if (parts.length === 1) return parts[0];
  return (title || "").trim() || "Job";
}

/** Postgres interval or HH:MM[:SS]. Empty when the job did not store a duration. */
export function durationAbout(raw?: string | null): string | null {
  if (!raw) return null;
  const m = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!h && !min) return null;
  if (!min) return `About ${h} hour${h === 1 ? "" : "s"}`;
  if (!h) return `About ${min} min`;
  return `About ${h} h ${min} min`;
}

export function jobTypeWord(jobType?: string | null, title?: string | null): string {
  const blob = `${jobType || ""} ${title || ""}`.toLowerCase();
  if (/install/.test(blob)) return "Installation";
  if (/repair|service|maintenance/.test(blob)) return "Service";
  if (/follow/.test(blob)) return "Follow-up";
  if (/quote|consult|sales/.test(blob)) return "Quote visit";
  return (jobType || title || "Job").replace(/_/g, " ");
}
