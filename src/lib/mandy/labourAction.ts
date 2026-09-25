import { findAreaLabour, planLabour, snapHours } from "@/lib/labour";
import { fmtRand, type MandyResult } from "@/lib/mandy/actions";

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
  if (line) await d.updateItem(line.id, fields);
  else {
    const sort = d.items.length ? Math.max(...d.items.map((i) => i.sort_order || 0)) + 1 : 0;
    await d.addItem({ ...fields, area_id: area.id, sort_order: sort, source: "mandy_voice" });
  }
  const label = line?.description || line?.name || "Labour";
  return {
    ok: true,
    message: `${label} (${area.name}) ${oldHours} h → ${fields.quantity} h, ${fmtRand(fields.total_price)} excl. VAT at ${fmtRand(fields.unit_price)}/h.`,
    data: { old_hours: oldHours, new_hours: fields.quantity, total: fields.total_price, mode },
  };
}
