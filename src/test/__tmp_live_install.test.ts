// TEMPORARY — deleted after the live check. Produces per-step SQL from the real functions.
import { it } from "vitest";
import fs from "node:fs";
import { addCatalogProductToQuote } from "@/lib/mandy/quoteOps";
import { runInstallEdit, parseInstallCommand, installLinesOf } from "@/lib/mandy/installEdits";
import { setActiveQuoteMarkupRates, resolveProductMarkupPercent } from "@/lib/pricing";
import { captureSnapshot, planRestore } from "@/lib/mandy/undo";

const D = "/tmp/sit";
const QID = "8bed9c7a-2577-40b6-876a-c0ebc2de9194";
const GENERAL = "104bbbea-222d-4795-9cc0-d439fa107797";
const rd = (f: string) => JSON.parse(fs.readFileSync(`${D}/${f}`, "utf8"));

it("live install harness", async () => {
  setActiveQuoteMarkupRates({ units: 25, materials: 100 } as any);
  const products = (rd("products.json") as any[]).map((p) => ({
    ...p, product_category: p.product_category || p.category || "", supplier_name: p.suppliers?.name || "", supplier_type: p.suppliers?.supplier_type || "both",
    price_per_metre: p.price_per_metre || null, sold_in_length: p.sold_in_length || false, unit_length: p.unit_length || null, cost_price: p.cost_price ?? 0,
  })).map((p) => ({ ...p, default_markup_percent: resolveProductMarkupPercent(p) }));
  const bundles = (rd("bundles.json") as any[]).map((b) => ({ ...b, items: (b.items || []).map((i: any) => ({ ...i, product: i.product ? { ...i.product, product_category: i.product.product_category || i.product.category || "", sold_in_length: !!i.product.sold_in_length, price_per_metre: i.product.price_per_metre || null } : null })) }));
  const templates = (rd("templates.json") as any[]).map((t) => ({ ...t, items: (t.install_template_items || []).map((i: any) => ({ ...i, default_qty: Number(i.default_qty) || 1, default_length_m: i.default_length_m == null ? null : Number(i.default_length_m) })).sort((a: any, b: any) => a.sort_order - b.sort_order) }));
  const areas = rd("snap_areas.json");
  let items: any[] = rd("snap_items.json");

  const steps: any[] = [];
  let ops: string[] = [];
  const lit = (v: any) => v == null ? "null" : typeof v === "number" ? String(v) : typeof v === "boolean" ? String(v) : typeof v === "object" ? `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb` : `'${String(v).replace(/'/g, "''")}'`;
  const COLS = ["id", "quote_id", "area_id", "parent_item_id", "product_id", "item_name", "item_number", "description", "quantity", "length", "unit_price", "total_price", "is_bundle", "item_type", "metadata", "sort_order", "notes", "source", "supplier"];
  const insertSql = (r: any) => `insert into quote_items (${COLS.join(",")}) values (${COLS.map((c) => lit(r[c])).join(",")});`;
  const addItem = async (r: any) => {
    const row = { ...r, id: crypto.randomUUID(), quote_id: QID, total_price: r.total_price ?? Number(((Number(r.quantity) || 1) * Number(r.unit_price)).toFixed(2)) };
    items.push(row); ops.push(insertSql(row)); return row;
  };
  const updateItem = async (id: string, patch: any) => {
    const i = items.findIndex((x) => x.id === id); if (i < 0) return false;
    items[i] = { ...items[i], ...patch };
    ops.push(`update quote_items set ${Object.entries(patch).map(([k, v]) => `${k}=${lit(v)}`).join(", ")} where id='${id}' and quote_id='${QID}';`);
    return true;
  };
  const deleteItem = async (id: string) => { items = items.filter((x) => x.id !== id); ops.push(`delete from quote_items where id='${id}' and quote_id='${QID}';`); return true; };
  const areaName = (id?: string | null) => areas.find((a: any) => a.id === id)?.name || "";
  const flush = (label: string, extra: any = {}) => { steps.push({ label, sql: ops.join("\n"), ...extra }); ops = []; };
  const sortNext = () => Math.max(...items.map((i) => i.sort_order || 0)) + 1;
  const pick = (code: string) => products.find((p: any) => p.product_code === code);

  // ── Adds ──
  const add = async (code: string) => {
    const r = await addCatalogProductToQuote({ addItem, product: pick(code), areaId: GENERAL, sortOrder: sortNext(), bundles, templates, liveProducts: products as any, source: "mandy_voice" });
    return r;
  };
  const r12 = await add("AR40F12C0AG/FA");
  flush("add 12K", { unit: r12.line!.id, lines: [r12.line, r12.kit, ...r12.installLines].map((l: any) => l.id), notes: r12.notes });
  const r18 = await add("AR40F18C0AG/FA");
  flush("add 18K", { unit: r18.line!.id, lines: [r18.line, r18.kit, ...r18.installLines].map((l: any) => l.id), notes: r18.notes });
  const u12 = r12.line!.id, u18 = r18.line!.id;

  const deps = () => ({ items, areaName, liveProducts: products, addItem, updateItem, deleteItem });
  const say = async (utt: string, chooseUnit: string | null, confirm: "yes" | "cancel" | null) => {
    const op = parseInstallCommand(utt)!;
    const r1 = await runInstallEdit(deps(), op as any);
    const log: string[] = [`parse→edit_install ${JSON.stringify(op)}`, `reply1: ${r1.message}`];
    let r = r1;
    if (r1.choices?.length && chooseUnit) {
      log.push(`chips: ${r1.choices.map((c) => c.label).join(" / ")}`);
      const c = r1.choices.find((c) => c.args.unit_item_id === chooseUnit)!;
      r = await runInstallEdit(deps(), c.args as any);
      log.push(`tap ${c.label} → ${r.message}`);
    }
    if (r.confirm) {
      log.push(`card: ${r.confirm.summary} [${r.confirm.lines.join("; ")}]`);
      if (confirm === "yes") { const rr = await r.confirm.run(); log.push(`confirm → ${rr.message}`); r = rr; }
      else log.push("cancel → Cancelled — nothing was changed.");
    }
    flush(utt, { log, reply: r.message });
  };
  await say("make the piping 3 metres", u12, null);
  await say("use a 550 bracket", u12, null);
  await say("flatback bracket", u18, null);
  await say("2 lengths of 100 by 40", u12, null);
  await say("2 end caps", u12, null);
  await say("remove the small trunking", u12, "yes");
  await say("no drain", u12, "yes");
  await say("add a bend", u12, null);
  await say("install without trunking", u12, "cancel");

  // 10: remove the 18K unit — same id list as the remove_item handler (unit + install lines), then undo.
  const before10 = captureSnapshot({ notes: null }, areas, items);
  const inst18 = installLinesOf(items, u18);
  const ids10 = [u18, ...inst18.map((l) => l.id)];
  for (const id of ids10) await deleteItem(id);
  flush("remove the Samsung 18K (confirm)", { log: [`card: Remove Samsung 18K INV MW and its install (kit + ${inst18.length - 1} lines) from General? — ${ids10.length} rows`] });
  let p = planRestore(before10, { notes: null, areas, items });
  for (const i of p.insertItems) { items.push({ ...i, quote_id: QID }); ops.push(insertSql({ ...i, quote_id: QID })); }
  flush("undo (18K removal)", { restored: p.insertItems.length, deleted: p.deleteItems.length });

  // 11: fresh 12K add, then ONE undo removes the unit + its whole install.
  const before11 = captureSnapshot({ notes: null }, areas, items);
  const r12b = await add("AR40F12C0AG/FA");
  flush("add 12K again", { lines: [r12b.line, r12b.kit, ...r12b.installLines].map((l: any) => l.id) });
  p = planRestore(before11, { notes: null, areas, items });
  for (const id of p.deleteItems) await deleteItem(id);
  flush("undo (12K add)", { deleted: p.deleteItems.length, updated: p.updateItems.length, inserted: p.insertItems.length });

  fs.writeFileSync(`${D}/steps.json`, JSON.stringify(steps, null, 1));
  fs.writeFileSync(`${D}/final_items.json`, JSON.stringify(items.map((i) => ({ id: i.id, code: i.item_number, name: i.item_name, q: i.quantity, len: i.length, up: i.unit_price, tp: i.total_price, role: i.metadata?.install?.role, unit: i.metadata?.install?.unit_item_id }))));
});
