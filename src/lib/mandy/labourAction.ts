import { findAreaLabour, isLabourItem, planLabour, snapHours } from "@/lib/labour";
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
/** Labour rows (top-level) with their area. */
export function labourRows(d: Pick<Deps, "areas" | "items">) {
  return d.items.filter((i) => !i.parent_item_id && isLabourItem(i)).map((i) => ({
    item: i, area: d.areas.find((a) => a.id === i.area_id) || null,
    hours: snapHours(Number(i.metadata?.hours ?? i.quantity ?? 0)),
    rate: Number(i.metadata?.rate ?? i.unit_price ?? 0), total: Number(i.total_price) || 0,
  }));
}
const hrsTxt = (h: number) => `${h} hour${h === 1 ? "" : "s"}`;

/** Compact summary for Mandy's context: "General 5.5h @R680 = R3 740; Bedroom 1 none". */
export function labourSummary(d: Pick<Deps, "areas" | "items">): string {
  const rows = labourRows(d);
  return d.areas.map((a) => {
    const r = rows.find((x) => x.area?.id === a.id);
    return r ? `${a.name} ${r.hours}h @${spokenRand(r.rate)} = ${spokenRand(r.total)}` : `${a.name} none`;
  }).join("; ");
}

/** read_labour — spoken list from the real rows. */
export function readLabour(d: Pick<Deps, "areas" | "items">): MandyResult {
  const rows = labourRows(d);
  const parts = d.areas.map((a) => {
    const r = rows.find((x) => x.area?.id === a.id);
    return r ? `${a.name} ${hrsTxt(r.hours)} at ${spokenRand(r.rate)}, ${spokenRand(r.total)}` : `${a.name} none`;
  });
  const total = rows.reduce((s, r) => s + r.total, 0);
  return { ok: true, message: `Labour: ${parts.join("; ")}. Total labour ${spokenRand(total)}.`, data: { rows: rows.map((r) => ({ area: r.area?.name, hours: r.hours, rate: r.rate, total: r.total })), total } };
}

/** remove_labour — always a Confirm card; run() deletes the rows. */
export function buildRemoveLabour(
  d: Pick<Deps, "areas" | "items"> & { deleteItem: (id: string) => Promise<unknown> },
  args: Record<string, unknown>,
  after?: () => Promise<void>,
): MandyResult {
  const rows = labourRows(d);
  if (!rows.length) return { ok: false, message: "There's no labour on this quote." };
  let pick = rows;
  if (!args.all) {
    const n = lc(String(args.area || ""));
    pick = n
      ? rows.filter((r) => lc(r.area?.name) === n).concat(rows.filter((r) => lc(r.area?.name) !== n && (lc(r.area?.name).includes(n) || n.includes(lc(r.area?.name))))).slice(0, 1)
      : rows.length === 1 ? rows : [];
    if (!pick.length) {
      return {
        ok: true,
        message: n ? `No labour in “${args.area}”. Waiting for the user to tap one.` : "Which area's labour? Waiting for the user to tap one.",
        choices: rows.filter((r) => r.area).map((r) => ({ label: r.area!.name, action: "remove_labour", args: { area: r.area!.name } })),
      };
    }
  }
  const total = pick.reduce((s, r) => s + r.total, 0);
  const where = args.all ? "all areas" : pick[0].area?.name || "the quote";
  const lines = pick.map((r) => `${r.area?.name || "No area"} · ${hrsTxt(r.hours)} × ${spokenRand(r.rate)} = ${spokenRand(r.total)}`);
  const run = async (): Promise<MandyResult> => {
    try {
      for (const r of pick) { const res = await d.deleteItem(r.item.id); if (res === false) throw new Error(); }
    } catch { return { ok: false, message: "Couldn't remove the labour — nothing was changed." }; }
    await after?.();
    return { ok: true, message: `Removed labour from ${where}, ${spokenRand(total)}.`, data: { removed: pick.length, total } };
  };
  return {
    ok: true,
    message: `Awaiting on-screen confirmation to remove labour from ${where}.`,
    confirm: { summary: `Remove labour from ${where}?`, lines, run },
  };
}

/** set_labour_hours(area, hours?, rate?) — create or update that area's Labour row. */
export async function runSetLabourHours(d: Deps, args: Record<string, unknown>): Promise<MandyResult> {
  const hasHours = args.hours != null && args.hours !== "";
  const hasRate = args.rate != null && Number(args.rate) > 0;
  if (!hasHours && !hasRate) return { ok: false, message: "Tell me how many hours." };
  if (hasHours && !(Number(args.hours) >= 0)) return { ok: false, message: "Tell me how many hours." };
  const mode: "add" | "set" = !hasHours || args.mode === "set" ? "set" : "add";
  const n = lc(String(args.area || ""));
  const rows = labourRows(d);
  let area = !n
    ? (d.areas.length === 1 ? d.areas[0] : rows.length === 1 ? rows[0].area : null)
    : d.areas.find((a) => lc(a.name) === n) || d.areas.find((a) => lc(a.name).includes(n) || n.includes(lc(a.name))) || null;
  const chipArgs = { ...(hasHours ? { hours: Number(args.hours) } : {}), mode, ...(hasRate ? { rate: Number(args.rate) } : {}) };
  if (!area) {
    const pool = !n && rows.length > 1 ? rows.map((r) => r.area!).filter(Boolean) : d.areas;
    return {
      ok: true,
      message: n ? `No area called “${args.area}”. Waiting for the user to tap one.` : "Which area? Waiting for the user to tap one.",
      choices: pool.map((a) => ({ label: a.name, action: "set_labour_hours", args: { area: a.name, ...chipArgs } })),
    };
  }
  area = area!;
  const line = findAreaLabour(d.items, area.id);
  const oldHours = line ? snapHours(Number(line.metadata?.hours ?? line.quantity ?? 0)) : 0;
  if (!hasHours && !line) return { ok: false, message: `There's no labour in ${area.name} yet.` };
  const hours = snapHours(!hasHours ? oldHours : mode === "add" ? oldHours + Number(args.hours) : Number(args.hours));
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
  const hrs = hrsTxt;
  return {
    ok: true,
    message: mode === "add"
      ? `Added ${hrs(snapHours(Number(args.hours)))} labour to ${area.name}, ${spokenRand(fields.total_price)}${rateTxt}.`
      : `Labour in ${area.name} set to ${hrs(fields.quantity)}, ${spokenRand(fields.total_price)}${rateTxt}.`,
    data: { old_hours: oldHours, new_hours: fields.quantity, total: fields.total_price, mode },
  };
}
