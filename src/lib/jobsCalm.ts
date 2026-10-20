/**
 * Calm Jobs page (Johan 20 Oct, behind a flag): pure helpers for the timeline, chips and the preview flag.
 * Block kinds: install blue · service/repair orange · maintenance green · sales purple · done grey · late red dashed.
 */
import type { CardJob } from "@/lib/cardModel";

export type BlockKind = "install" | "service" | "maintenance" | "sales" | "done" | "late";
export const DAY_START = 8 * 60;
export const DAY_END = 17 * 60;

export const BLOCK_STYLE: Record<BlockKind, string> = {
  install: "border-sky-300 bg-sky-50 text-sky-900",
  service: "border-orange-300 bg-orange-50 text-orange-900",
  maintenance: "border-emerald-300 bg-emerald-50 text-emerald-900",
  sales: "border-violet-300 bg-violet-50 text-violet-900",
  done: "border-slate-200 bg-slate-50 text-slate-500",
  late: "border-dashed border-red-400 bg-red-50 text-red-800",
};

export function blockKind(c: Pick<CardJob, "lane" | "title" | "statusKey" | "urgency">, jobType?: string | null): BlockKind {
  const s = String(c.statusKey || "").toLowerCase();
  if (s === "completed" || c.urgency?.key === "done") return "done";
  if (c.urgency?.key === "late") return "late";
  if (c.lane === "sales") return "sales";
  const t = `${jobType || ""} ${c.title || ""}`;
  if (/mainten/i.test(t)) return "maintenance";
  if (c.lane === "install" || /install/i.test(t)) return "install";
  return "service";
}

/** Minutes after midnight in Johannesburg (UTC+2, no DST) for an ISO time; null for date-only/invalid. */
export function jhbMinutes(iso: string | null | undefined): number | null {
  if (!iso || /^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  return Math.floor(((t / 60000 + 120) % 1440 + 1440) % 1440);
}

/** Left/width in % of the 08:00–17:00 window, clamped; null when it falls entirely outside. */
export function blockPos(startMin: number, durMin: number): { left: number; width: number } | null {
  const a = Math.max(DAY_START, startMin), b = Math.min(DAY_END, startMin + durMin);
  if (b <= a) return null;
  const span = DAY_END - DAY_START;
  return { left: ((a - DAY_START) / span) * 100, width: ((b - a) / span) * 100 };
}

/** Snap an x fraction (0–1) of the window to a 30-min start time. */
export function snapStart(frac: number): number {
  const m = DAY_START + Math.max(0, Math.min(1, frac)) * (DAY_END - DAY_START);
  return Math.min(DAY_END - 30, Math.round(m / 30) * 30);
}

/** ISO with +02:00 for a JHB date + minutes. */
export function jhbIso(day: string, mins: number): string {
  const hh = String(Math.floor(mins / 60)).padStart(2, "0"), mm = String(mins % 60).padStart(2, "0");
  return `${day}T${hh}:${mm}:00+02:00`;
}

/** Share of a person's day already done (0–100), by completed blocks out of all. */
export function dayProgress(kinds: BlockKind[]): number {
  return kinds.length ? Math.round((kinds.filter((k) => k === "done").length / kinds.length) * 100) : 0;
}

export type ChipKey = "leads" | "late" | "unassigned";
export function needsYou(n: { leadsNotContacted: number; late: number; unassigned: number }) {
  return ([
    { key: "leads" as ChipKey, n: n.leadsNotContacted, label: n.leadsNotContacted === 1 ? "lead not contacted" : "leads not contacted", tone: "red" },
    { key: "late" as ChipKey, n: n.late, label: n.late === 1 ? "job late" : "jobs late", tone: "red" },
    { key: "unassigned" as ChipKey, n: n.unassigned, label: "unassigned", tone: "amber" },
  ]).filter((c) => c.n > 0).slice(0, 3);
}

/** Lead age badge tone: green < 15 min, amber < 60 min, red after. */
export function ageTone(createdAt: string | null | undefined, now = new Date()): { mins: number; tone: "green" | "amber" | "red" } {
  const mins = createdAt ? Math.max(0, Math.round((now.getTime() - new Date(createdAt).getTime()) / 60000)) : 0;
  return { mins, tone: mins < 15 ? "green" : mins < 60 ? "amber" : "red" };
}

/** Calm page is ON by default (live 20 Oct). ?jobs=classic opts this browser out (remembered), ?jobs=calm back in. */
export const CALM_KEY = "fls.jobs.classic";
export function calmEnabled(search: string, storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null): boolean {
  const q = new URLSearchParams(search).get("jobs");
  try {
    if (q === "classic") { storage?.setItem(CALM_KEY, "1"); return false; }
    if (q === "calm") { storage?.removeItem(CALM_KEY); return true; }
    return storage?.getItem(CALM_KEY) !== "1";
  } catch { return q !== "classic"; }
}

/** Month grid (Mon–Sun weeks) covering the month of `day` (YYYY-MM-DD): whole weeks, 4–6 rows. */
export function monthGrid(day: string): { day: string; inMonth: boolean }[] {
  const [y, m] = day.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = Math.ceil((lead + days) / 7) * 7;
  return Array.from({ length: cells }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1, 1 - lead + i));
    return { day: d.toISOString().slice(0, 10), inMonth: d.getUTCMonth() === m - 1 };
  });
}
