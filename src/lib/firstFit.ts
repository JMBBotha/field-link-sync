/** First fit complete, Live, and the two issue dates. Pure rules shared with the SQL. */

export const UNIT_SIZES = ["9K", "12K", "18K", "24K"] as const;
export type UnitSize = (typeof UNIT_SIZES)[number];
export const DEFAULT_WALL_UNIT = "Samsung AR40H wall unit";
export const PIPE_MAX_M = 200;
export const DEFAULT_DEPOSIT_DAYS = 45;
export const DEFAULT_BALANCE_DAYS = 60;
export const DEFAULT_PREPARE_DAYS = 7;

export type IssueState = "upcoming" | "due_soon" | "due_today" | "overdue" | "estimated";

export const ISSUE_LABEL: Record<IssueState, string> = {
  upcoming: "Upcoming",
  due_soon: "Due soon",
  due_today: "Due today",
  overdue: "Overdue to issue",
  estimated: "Estimated",
};

const SIZE_KEYS: Record<string, UnitSize> = {
  "9": "9K", "9k": "9K", "9btu": "9K", "9000": "9K", "9000btu": "9K",
  "12": "12K", "12k": "12K", "12btu": "12K", "12000": "12K", "12000btu": "12K",
  "18": "18K", "18k": "18K", "18btu": "18K", "18000": "18K", "18000btu": "18K",
  "24": "24K", "24k": "24K", "24btu": "24K", "24000": "24K", "24000btu": "24K",
};

export function normalizeUnitSize(raw: string | number | null | undefined): UnitSize | null {
  const s = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, "");
  return SIZE_KEYS[s] ?? null;
}

/** Metres, optional decimal comma, optional m suffix. Rejects 0 and anything over 200. */
export function parsePipeMetres(raw: string | number | null | undefined): number | null {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= 0 || raw > PIPE_MAX_M) return null;
    return Math.round(raw * 100) / 100;
  }
  const s = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, "").replace(",", ".").replace(/m\.?$/, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || n > PIPE_MAX_M) return null;
  return Math.round(n * 100) / 100;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Next `day` of the month on or after `iso`. A null day leaves the date alone. */
export function snapOnOrAfter(iso: string, day: number | null | undefined): string {
  if (day == null) return iso;
  const [y, m, d] = iso.split("-").map(Number);
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const use = Math.min(day, dim);
  if (d <= use) return pad(y, m, use);
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  const dim2 = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return pad(ny, nm, Math.min(day, dim2));
}

function pad(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Estimated balance dates never become overdue, due today, or due soon. */
export function issueState(due: string, today: string, prepareDays: number, estimated: boolean): IssueState {
  if (estimated) return "estimated";
  if (today > due) return "overdue";
  if (today === due) return "due_today";
  if (today >= addDays(due, -Math.max(0, prepareDays))) return "due_soon";
  return "upcoming";
}

export interface IssuePlanInput {
  completeOn: string;
  today: string;
  depositDays?: number;
  balanceDays?: number;
  snapDay?: number | null;
  prepareDays?: number;
  /** Johannesburg date the deposit invoice was actually issued. Null until then. */
  depositIssuedOn?: string | null;
}

export interface IssuePlan {
  depositOn: string;
  balanceOn: string;
  balanceEstimated: boolean;
  depositState: IssueState;
  balanceState: IssueState;
  prepareDeposit: boolean;
  prepareBalance: boolean;
}

export function issuePlan(input: IssuePlanInput): IssuePlan {
  const depositDays = input.depositDays ?? DEFAULT_DEPOSIT_DAYS;
  const balanceDays = input.balanceDays ?? DEFAULT_BALANCE_DAYS;
  const prepareDays = input.prepareDays ?? DEFAULT_PREPARE_DAYS;
  const snap = input.snapDay ?? null;
  const depositOn = snapOnOrAfter(addDays(input.completeOn, depositDays), snap);
  const issued = input.depositIssuedOn || null;
  const balanceOn = snapOnOrAfter(addDays(issued || depositOn, balanceDays), snap);
  const balanceEstimated = !issued;
  const depositState = issueState(depositOn, input.today, prepareDays, false);
  const balanceState = issueState(balanceOn, input.today, prepareDays, balanceEstimated);
  const prepareDeposit = input.today >= addDays(depositOn, -Math.max(0, prepareDays));
  const prepareBalance = !balanceEstimated && input.today >= addDays(balanceOn, -Math.max(0, prepareDays));
  return { depositOn, balanceOn, balanceEstimated, depositState, balanceState, prepareDeposit, prepareBalance };
}

export interface FitPoint {
  area: string;
  unitSize: string;
  pipeM: number;
}

/** The tap is allowed when every saved point is complete, there is at least one, and every listed area has a point. */
export function firstFitReady(units: { area: string }[], points: FitPoint[]): { ok: boolean; reason: string | null } {
  if (!points.length) return { ok: false, reason: "Add at least one point with an area, a unit size and pipe metres." };
  const incomplete = points.filter((p) => !p.area.trim() || !normalizeUnitSize(p.unitSize) || !(p.pipeM > 0));
  if (incomplete.length) return { ok: false, reason: "Every point needs an area, a unit size and pipe metres." };
  const missing = units.filter((u) => !points.some((p) => p.area.trim().toLowerCase() === u.area.trim().toLowerCase()));
  if (missing.length) {
    const names = missing.map((m) => m.area.trim()).filter(Boolean);
    return { ok: false, reason: names.length === 1 ? `${names[0]} still needs a point.` : `${names.join(", ")} still need a point.` };
  }
  return { ok: true, reason: null };
}

export function pipeTotal(points: { pipeM: number }[]): number {
  return Math.round(points.reduce((s, p) => s + (Number(p.pipeM) || 0), 0) * 100) / 100;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Deposit is half the quote, capped so it cannot exceed what is still uninvoiced. */
export function depositAmount(quoteTotal: number, otherInvoiced: number): number {
  const room = r2(quoteTotal - otherInvoiced);
  if (room <= 0) return 0;
  return r2(Math.min(r2(quoteTotal * 0.5), room));
}

/** Balance is the quote total minus every other live invoice on the house. */
export function balanceAmount(quoteTotal: number, invoicedExceptBalance: number): number {
  return r2(quoteTotal - invoicedExceptBalance);
}

/** One percent discount on the quote total. Line prices are not reduced. */
export function quoteTotals(subtotal: number, discountPercent: number, vatRate = 0.15) {
  const discount = discountPercent > 0 ? subtotal * (discountPercent / 100) : 0;
  const net = subtotal - discount;
  return {
    subtotal,
    discount,
    vat: Math.round(net * vatRate * 100) / 100,
    total: Math.round(net * (1 + vatRate) * 100) / 100,
  };
}

/** "ERF 17528". A number that already starts with ERF is not doubled. */
export function formatErf(houseNo: string): string {
  const t = houseNo.trim().replace(/\s+/g, " ");
  if (/^erf\b/i.test(t)) return t.replace(/^erf\b/i, "ERF");
  return `ERF ${t}`;
}

/** Invoice page line. House numbers are de-duplicated and sorted. */
export function coversErfLine(houseNos: string[]): string {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const raw of houseNos) {
    const label = formatErf(raw);
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }
  labels.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  return `Covers ${labels.join(", ")}`;
}

/** House page line when full_system (or every staged scope) is already on an invoice. */
export function alreadyInvoicedOn(invoiceNo: string): string {
  return `Already invoiced on ${invoiceNo.trim()}`;
}

export function formatIssueDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00+02:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Johannesburg" });
}
