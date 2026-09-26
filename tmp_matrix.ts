import { readFileSync } from "fs";
import { parseQuoteIntent, clearRefusal, clearSummary, CLEARED_MESSAGE } from "@/lib/mandy/quoteIntent";
import { parseLabourIntent } from "@/lib/mandy/labourParse";
import { resolveItemRef, findAreaFuzzy, noMatchMessage, chipLabel, isKitItem, isLabourRow } from "@/lib/mandy/itemResolve";
import { findUnitKits, qtyPatch } from "@/lib/mandy/quoteEdits";
import { buildRemoveLabour, runSetLabourHours, readLabour } from "@/lib/mandy/labourAction";
import { fmtRand } from "@/lib/mandy/actions";

const d = JSON.parse(readFileSync("/tmp/baseline.json", "utf8"));
const areas = d.a, items = d.i;
const an = (id: string) => areas.find((a: any) => a.id === id)?.name || "";
const out: any[] = [];
const noop = async () => true;

async function route(u: string, pending = false, status = "draft") {
  const qi = parseQuoteIntent(u, { pendingCard: pending });
  const lab = !qi ? parseLabourIntent(u) : null;
  const action = qi?.action || lab?.action || "(model)";
  const args: any = qi?.args || lab?.args || {};
  let reply = "", card = "", chips: string[] = [], sql: any = null;
  if (action === "clear_quote") {
    const ref = clearRefusal("Q-2026-0014", status);
    if (ref) reply = ref;
    else {
      const top = items.filter((i: any) => !i.parent_item_id);
      card = clearSummary("Q-2026-0014", { items: top.filter((i: any) => !isKitItem(i) && !isLabourRow(i)).length, labour: top.filter(isLabourRow).length, kits: top.filter(isKitItem).length, areasRemoved: 0 });
      reply = CLEARED_MESSAGE; sql = { clear: true };
    }
  } else if (action === "remove_item") {
    const areaRef = String(args.item).replace(/^(the|my)\s+/i, "");
    if (findAreaFuzzy(areas, areaRef) && resolveItemRef(items, areas, areaRef).kind !== "one") {
      const a = findAreaFuzzy(areas, areaRef)!; const lines = items.filter((i: any) => i.area_id === a.id && !i.parent_item_id);
      card = `Remove ${a.name} and its ${lines.length} lines? [${lines.map((l: any) => `${l.item_name.slice(0, 24)} · ${fmtRand(l.total_price)}`).join("; ")}]`;
      reply = `Removed area ${a.name} and its ${lines.length} lines.`; sql = { removeArea: a.id };
    } else {
      const r = resolveItemRef(items, areas, args.item);
      if (r.kind === "none") reply = noMatchMessage(r.query, items, areas);
      else if (r.kind === "many") chips = r.hits.map((h) => chipLabel(h, areas));
      else {
        const kits = findUnitKits(items, r.item); const ids = [r.item.id, ...kits.map((k: any) => k.id)];
        const label = `${r.item.item_name}${ids.length > 1 ? " and its kit" : ""}`;
        card = `Remove ${label} from ${an(r.item.area_id)}?`; reply = `Removed ${label}.`; sql = { deleteIds: ids };
        if (kits.length) chips = ["Remove unit only (keep kit)"];
      }
    }
  } else if (action === "set_qty") {
    const r = resolveItemRef(items, areas, args.item);
    if (r.kind === "one") { const p = qtyPatch(r.item, args.qty); reply = `${r.item.item_name}: ${p.value}, ${fmtRand(Number(p.patch.total_price))} excl. VAT.`; sql = { update: { id: r.item.id, patch: p.patch } }; }
  } else if (action === "remove_labour") {
    const res = buildRemoveLabour({ areas, items, deleteItem: noop }, args);
    if (res.choices) chips = res.choices.map((c) => c.label); else if (res.confirm) { card = `${res.confirm.summary} [${res.confirm.lines?.join("; ")}]`; reply = (await res.confirm.run()).message; const a = findAreaFuzzy(areas, args.area)!; sql = { deleteIds: items.filter((i: any) => isLabourRow(i) && i.area_id === a.id).map((i: any) => i.id) }; }
    else reply = res.message;
  } else if (action === "set_labour_hours") {
    const res = await runSetLabourHours({ areas, items, standardRate: 680, addItem: noop, updateItem: noop }, args);
    chips = res.choices?.map((c) => c.label) || []; reply = res.message;
  } else if (action === "read_labour") reply = readLabour({ areas, items }).message;
  else if (action === "add_area") { reply = `Added area ${args.name}.`; sql = { addArea: args.name }; }
  else if (action === "rename_area") { const a = findAreaFuzzy(areas, args.area)!; reply = `Renamed ${a.name} to ${args.new_name}.`; sql = { rename: { id: a.id, name: args.new_name } }; }
  else if (action === "cancel_pending") reply = "Cancelled — nothing was changed.";
  out.push({ u, action, args, card, chips, reply, sql });
}

const U = ["remove the AR40 12000", "take out the 12K kit", "delete the Samsung in bedroom one", "change the AR40 to 2", "remove the daikin", "remove labour",
  "remove the labour from bedroom one", "add 2 hours labour", "what labour is on this quote", "add an area called study", "rename bedroom one to main bedroom",
  "remove bedroom one", "clear the quote", "start over"];
for (const u of U) await route(u);
await route("start over", true);
await route("clear the quote", false, "accepted");
console.log(JSON.stringify(out, null, 1));
