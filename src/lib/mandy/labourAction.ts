import { findAreaLabour, planLabour, snapHours } from "@/lib/labour";
import type { MandyResult } from "@/lib/mandy/actions";

/** 'R2 040' when whole, 'R2 040,50' otherwise (space thousands). */
export function spokenRand(n: number): string {
  const v = Math.round(Number(n || 0) * 100) / 100;
  const [i, f] = v.toFixed(2).split(".");
  const int = i.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return f === "00" ? `R${int}` : `R${int},${f}`;
}

interface Deps {
  areas: { id: string; name: string }[];
  items: any[];
  standardRate: number | null;
  addItem: (row: any) => Promise<unknown>;
  updateItem: (id: string, patch: any) => Promise<unknown>;
}

const lc = (s?: string | null) => (s || "").trim().toLowerCase();

/** set_labour_hours(area, hours, rate?) — create or update that area's Labour row. */
export async function runSetLabourHours(d: Deps, args: Record<string, unknown>): Promise<MandyResult> {
  if (!(Number(args.hours) >= 0)) return { ok: false, message: "Tell me how many hours." };
  const mode: "add" | "set" = args.mode === "set" ? "set" : "add";
  const n = lc(String(args.area || ""));
  const area = !n
    ? (d.areas.length === 1 ? d.areas[0] : null)
    : d.areas.find((a) => lc(a.name) === n) || d.areas.find((a) => lc(a.name).includes(n) || n.includes(lc(a.name))) || null;
  if (!area) {
    return {
      ok: true,
      message: `No area called “${args.area || ""}”. Waiting for the user to tap one.`,
      choices: d.areas.map((a) => ({ label: a.name, action: "set_labour_hours", args: { area: a.name, hours: Number(args.hours), mode, ...(args.rate ? { rate: args.rate } : {}) } })),
    };
  }
  const line = findAreaLabour(d.items, area.id);
  const oldHours = line ? snapHours(Number(line.metadata?.hours ?? line.quantity ?? 0)) : 0;
  const hours = snapHours(mode === "add" ? oldHours + Number(args.hours) : Number(args.hours));
  const plan = planLabour(line, hours, d.standardRate, args.rate != null ? Number(args.rate) : null);
  const fields = plan.fields;
    if (plan.needsRate || !fields) return { ok: false, message: "No labour rate set. Say the rate, or set the standard rate in Settings." };
  try {
    const res = line
      ? await d.updateItem(line.id, fields)
      : await d.addItem({ ...fields, area_id: area.id, sort_order: d.items.length ? Math.max(...d.items.map((i) => i.sort_order || 0)) + 1 : 0, source: "mandy_voice" });
    if (res === null || res === false) return { ok: false, message: "Couldn't update the labour — nothing was changed." };
  } catch {
    return { ok: false, message: "Couldn't update the labour — nothing was changed." };
  }
  const rateTxt = args.rate != null ? ` at ${spokenRand(Number(args.rate))} an hour` : "";
  const hrs = (h: number) => `${h} hour${h === 1 ? "" : "s"}`;
  return {
    ok: true,
    message: mode === "add"
      ? `Added ${hrs(snapHours(Number(args.hours)))} labour to ${area.name}, ${spokenRand(fields.total_price)}${rateTxt}.`
      : `Labour in ${area.name} set to ${hrs(fields.quantity)}, ${spokenRand(fields.total_price)}${rateTxt}.`,
    data: { old_hours: oldHours, new_hours: fields.quantity, total: fields.total_price, mode },
  };
}
