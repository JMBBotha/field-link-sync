// One Unpaid rule for the invoices list: chip count = list = Outstanding (Johan 31 Oct t2016u/t2017u).
// Every non-void, non-draft, non-paid invoice with a balance owing, whatever its due state.
export type UnpaidBucket = "overdue" | "soon" | "completion";
export type DueLike = { days: number | null; waiting?: boolean } | null | undefined;
const CLOSED = new Set(["paid", "void", "cancelled", "draft"]);

export function isUnpaid(status: string | null | undefined, balance: number): boolean {
  return !CLOSED.has(String(status || "").toLowerCase()) && balance > 0.005;
}

/** overdue = past due; soon = has a due date not passed yet (incl. today); completion = no due date yet. */
export function unpaidBucket(status: string | null | undefined, due: DueLike): UnpaidBucket {
  if (due && !due.waiting && typeof due.days === "number") return due.days > 0 ? "overdue" : "soon";
  if (!due && String(status || "").toLowerCase() === "overdue") return "overdue";
  return "completion";
}
const ORDER: Record<UnpaidBucket, number> = { overdue: 0, soon: 1, completion: 2 };

export const BUCKET_LABEL: Record<UnpaidBucket, string> = { overdue: "Overdue", soon: "Due soon", completion: "Due on completion" };
export const BUCKET_TONE: Record<UnpaidBucket, "red" | "orange" | "neutral"> = { overdue: "red", soon: "orange", completion: "neutral" };

/** Overdue (most late first), then due soon (soonest first), then due on completion. */
export function sortUnpaid<T>(rows: T[], get: (r: T) => { status: string | null | undefined; due: DueLike }): T[] {
  return rows.map((r, i) => ({ r, i, ...get(r) })).sort((a, b) => {
    const ba = unpaidBucket(a.status, a.due), bb = unpaidBucket(b.status, b.due);
    if (ba !== bb) return ORDER[ba] - ORDER[bb];
    const da = a.due?.days ?? 0, db = b.due?.days ?? 0;
    return db - da || a.i - b.i;
  }).map((x) => x.r);
}
