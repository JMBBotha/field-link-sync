/** Ready to book is deposit-paid installs plus call-outs. A quote that is not accepted never appears. */
import { v8PackList, type V8QuoteLine } from "@/lib/v8simple/quote";
import { v8Stage, v8Track, type V8StageInput } from "@/lib/v8simple/stage";
import type { V8JobRow } from "@/lib/v8simple/jobs";

export function v8OnSchedule(input: V8StageInput): boolean {
  const stage = v8Stage(input);
  if (!stage.active) return false;
  if (stage.key === "lead" || stage.key === "visit" || stage.key === "quote_sent" || stage.key === "deposit_due") return false;
  if (v8Track(input) === "service") return stage.key === "booked" || stage.key === "on_site" || stage.key === "pay_due";
  return stage.key === "ready" || stage.key === "on_site";
}

export function v8AssignTech<T extends { input: V8StageInput }>(row: T, techId: string): T {
  return { ...row, input: { ...row.input, techId } };
}

export function v8TechCanSee(input: V8StageInput, techId: string): boolean {
  return !!techId && input.techId === techId && v8OnSchedule(input);
}

export function v8SchedulePack(lines: V8QuoteLine[]): V8QuoteLine[] {
  return v8PackList(lines);
}

export function v8ScheduleBoard(rows: V8JobRow[]) {
  return rows.filter((row) => v8OnSchedule(row.input));
}
