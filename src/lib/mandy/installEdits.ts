/**
 * Standard-install edits by role ("use a 550 bracket", "no drain", "2 end caps").
 * Lines are found by metadata.install.{unit_item_id, role} — never parent_item_id.
 * Pricing goes through catalogLineFields / kitLengthPatch only.
 */
import { catalogLineFields, kitLengthPatch, kitSwapPatch, type BundleForKit } from "@/lib/mandy/quoteOps";
import { parseKitSwapSizes, kitForSizes, swappableKits, kitSizeLabel } from "@/lib/kitSizes";
import { installTag, lengthLabel, ROLE_LABEL, type InstallRole } from "@/lib/installTemplates";
import { spokenRand } from "@/lib/mandy/labourAction";
import type { MandyResult } from "@/lib/mandy/actions";

export type InstallOp =
  | { op: "kit_length"; metres: number }
  | { op: "kit_swap"; sizes?: string[]; bundle_id?: string }
  | { op: "bracket"; size?: "450" | "550" | "650"; flatback?: boolean; code?: string }
  | { op: "set_qty"; role: InstallRole; qty: number }
  | { op: "add_bend" }
  | { op: "remove_roles"; roles: InstallRole[]; what: string };

const NUM: Record<string, number> = { one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const num = (s: string) => (NUM[s.toLowerCase()] ?? Number(s.replace(",", ".")));

/** Deterministic pre-route for install phrases. */
export function parseInstallCommand(text: string): InstallOp | null {
  const t = ` ${String(text || "").toLowerCase().replace(/[.!?]+$/, "").trim()} `;
  let m: RegExpMatchArray | null;
  const sizes = parseKitSwapSizes(t);
  if (sizes) return { op: "kit_swap", sizes };
  if ((m = t.match(/\b(?:make|set|change)\s+(?:the\s+)?(?:piping|pipe|kit|piping kit)\s+(?:to\s+)?(\d+(?:[.,]\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:m|metres?|meters?)\b/))) return { op: "kit_length", metres: num(m[1]) };
  if (/\bflat\s?back\b/.test(t) && /\bbracket|flat\s?back\b/.test(t)) {
    const s = t.match(/\b(450|550)\b/);
    return { op: "bracket", flatback: true, ...(s ? { size: s[1] as "450" | "550" } : {}) };
  }
  if ((m = t.match(/\b(450|550|650)\s*(?:mm\s*)?bracket/))) return { op: "bracket", size: m[1] as any };
  if (/\binstall(?:ation)?\s+without\s+trunking\b|\bno\s+trunking\b/.test(t)) return { op: "remove_roles", roles: ["trunking_main", "trunking_endcap", "trunking_small"], what: "trunking" };
  if (/\bno\s+drain\b|\bwithout\s+(?:a\s+)?drain\b|\bremove\s+(?:the\s+)?drain\b/.test(t)) return { op: "remove_roles", roles: ["drain_pipe", "drain_bend"], what: "drain" };
  if (/\bremove\s+(?:the\s+)?small\s+trunking\b/.test(t)) return { op: "remove_roles", roles: ["trunking_small"], what: "small trunking" };
  if (/\badd\s+(?:a|an|one|another)\s+(?:bend|elbow)\b/.test(t)) return { op: "add_bend" };
  if ((m = t.match(/\b(\d+|one|two|three|four|five|six)\s+lengths?\s+of\s+(100\s*(?:by|x)\s*40|16\s*(?:by|x)\s*16)\b/))) {
    return { op: "set_qty", role: m[2].startsWith("100") ? "trunking_main" : "trunking_small", qty: num(m[1]) };
  }
  if ((m = t.match(/\b(\d+|one|two|three|four|five|six)\s+end\s?caps?\b/))) return { op: "set_qty", role: "trunking_endcap", qty: num(m[1]) };
  if ((m = t.match(/\b(\d+|one|two|three|four|five|six|seven|eight)\s+(?:elbows|bends)\b/))) return { op: "set_qty", role: "drain_bend", qty: num(m[1]) };
  return null;
}

export interface IItem { id: string; item_name: string; item_number?: string | null; area_id?: string | null; product_id?: string | null; parent_item_id?: string | null; quantity?: number | null; unit_price?: number | null; total_price?: number | null; length?: number | null; metadata?: any }

/** Units (top-level lines) that own at least one install line, optionally in one area. */
export function unitsWithInstall(items: IItem[], areaId?: string | null): IItem[] {
  const owners = new Set(items.map((i) => installTag(i)?.unit_item_id).filter(Boolean) as string[]);
  return items.filter((i) => owners.has(i.id) && !i.parent_item_id && (!areaId || i.area_id === areaId));
}
export const installLinesOf = (items: IItem[], unitId: string) => items.filter((i) => installTag(i)?.unit_item_id === unitId);
const roleLine = (items: IItem[], unitId: string, role: InstallRole) => installLinesOf(items, unitId).find((i) => installTag(i)!.role === role) || null;

const DEFAULT_CODE: Partial<Record<InstallRole, string>> = { trunking_main: "TRUNK01", trunking_endcap: "TRUNKCAP01", trunking_small: "TRUNK02", drain_pipe: "DPIPE01", drain_bend: "ELB001" };
const SIZE_CODE: Record<string, string> = { "450": "BRAC01", "550": "BRAC02", "650": "BRAC05" };
const FLATBACK: Record<string, string> = { BRAC01: "BRAC14", BRAC02: "BRAC15", "450": "BRAC14", "550": "BRAC15" };

/** Spoken label: "1 × 3 m length" for length items, else "2 × End Caps". */
export function installLineLabel(i: IItem): string {
  const ll = lengthLabel(Number(i.quantity) || 1, i.metadata?.supplier_length_m);
  return ll ? `${i.item_name} (${ll})` : `${Number(i.quantity) || 1} × ${i.item_name}`;
}

export interface InstallDeps {
  items: IItem[];
  areaName: (id?: string | null) => string;
  liveProducts: any[];
  addItem: (row: any) => Promise<any>;
  updateItem: (id: string, patch: any) => Promise<any>;
  deleteItem: (id: string) => Promise<any>;
  /** Active kits (for kit swaps). */
  bundles?: BundleForKit[];
  after?: () => Promise<void>;
}

/** Run one install edit. Two units and no unit_item_id → chips. Removals → Confirm card. */
export async function runInstallEdit(d: InstallDeps, args: InstallOp & { unit_item_id?: string }): Promise<MandyResult> {
  const units = unitsWithInstall(d.items);
  const unit = args.unit_item_id ? units.find((u) => u.id === args.unit_item_id) : units.length === 1 ? units[0] : null;
  if (!units.length) return { ok: false, message: "There's no standard install on this quote yet — nothing was changed." };
  if (!unit) {
    return {
      ok: true,
      message: "Which unit? Waiting for the user to tap one.",
      choices: units.map((u) => ({ label: `${u.item_name} · ${d.areaName(u.area_id) || "No area"}`, action: "edit_install", args: { ...args, unit_item_id: u.id } })),
    };
  }
  const tag = (role: InstallRole) => ({ install: { unit_item_id: unit.id, role, template_id: installTag(installLinesOf(d.items, unit.id)[0])?.template_id ?? null } });
  const live = (code: string) => d.liveProducts.find((p) => String(p.product_code || "").toUpperCase() === code);
  const done = async (message: string): Promise<MandyResult> => { await d.after?.(); return { ok: true, message }; };
  const sortAfter = Math.max(0, ...installLinesOf(d.items, unit.id).map((i: any) => Number(i.sort_order) || 0)) + 1;

  const setQty = async (role: InstallRole, qty: number): Promise<MandyResult> => {
    const line = roleLine(d.items, unit.id, role);
    if (line) {
      const price = Number(line.unit_price) || 0;
      if (qty <= 0) { await d.deleteItem(line.id); return done(`Removed ${line.item_name}.`); }
      const ok = await d.updateItem(line.id, { quantity: qty, total_price: Number((qty * price).toFixed(2)) });
      if (ok === false || ok === null) return { ok: false, message: `Couldn't change ${ROLE_LABEL[role]} — nothing was changed.` };
      return done(`${ROLE_LABEL[role][0].toUpperCase()}${ROLE_LABEL[role].slice(1)} for ${unit.item_name} now ${installLineLabel({ ...line, quantity: qty })}, ${spokenRand(qty * price)}.`);
    }
    const code = DEFAULT_CODE[role];
    const p = code && live(code);
    if (!p) return { ok: false, message: `${code || ROLE_LABEL[role]} is not in the active price books — nothing was changed.` };
    const { unitSell: _u, ...f } = catalogLineFields(p, qty);
    const row = await d.addItem({ ...f, metadata: { ...f.metadata, ...tag(role) }, area_id: unit.area_id ?? null, parent_item_id: null, is_bundle: false, item_type: "product", sort_order: sortAfter, source: "mandy_voice", total_price: null, length: null, notes: null });
    if (!row) return { ok: false, message: `Couldn't add ${ROLE_LABEL[role]} — nothing was changed.` };
    return done(`Added ${installLineLabel(row)} to ${unit.item_name}'s install, ${spokenRand(qty * f.unit_price)}.`);
  };

  switch (args.op) {
    case "kit_length": {
      const kit = roleLine(d.items, unit.id, "piping_kit");
      if (!kit) return { ok: false, message: `${unit.item_name} has no piping kit — nothing was changed.` };
      const p = kitLengthPatch(kit as any, args.metres);
      const ok = await d.updateItem(kit.id, p);
      if (ok === false || ok === null) return { ok: false, message: "Couldn't change the kit length — nothing was changed." };
      return done(`Piping kit for ${unit.item_name} set to ${p.length} m, ${spokenRand(p.unit_price)}.`);
    }
    case "kit_swap": {
      const kit = roleLine(d.items, unit.id, "piping_kit");
      if (!kit) return { ok: false, message: `${unit.item_name} has no piping kit — nothing was changed.` };
      const pool = swappableKits((d.bundles || []) as any, d.liveProducts);
      const target = (args.bundle_id ? pool.find((b) => b.id === args.bundle_id) : kitForSizes(pool, args.sizes || [])) as BundleForKit | null;
      if (!target) return { ok: false, message: `There's no live ${(args.sizes || []).join(" + ") || "matching"} piping kit in the active price books — nothing was changed.` };
      if (kit.metadata?.kit?.bundle_id === target.id) return { ok: true, message: `${unit.item_name} already has the ${kitSizeLabel(target as any)} kit.` };
      const { perMetre: _p, ...patch } = kitSwapPatch(kit, target);
      const ok = await d.updateItem(kit.id, patch);
      if (ok === false || ok === null) return { ok: false, message: "Couldn't swap the kit — nothing was changed." };
      return done(`Kit for ${unit.item_name} is now ${kitSizeLabel(target as any)} (${target.name}), ${patch.length} m, ${spokenRand(patch.unit_price)}.`);
    }
    case "bracket": {
      const cur = roleLine(d.items, unit.id, "bracket");
      const curCode = String(cur?.item_number || "").toUpperCase();
      let code = args.code;
      if (!code && args.flatback) code = FLATBACK[args.size || ""] || FLATBACK[curCode];
      if (!code && args.size) code = SIZE_CODE[args.size];
      if (!code) {
        return { ok: true, message: "Flatback 450 or 550? Waiting for the user to tap one.", choices: [
          { label: "Flatback 450", action: "edit_install", args: { op: "bracket", code: "BRAC14", unit_item_id: unit.id } },
          { label: "Flatback 550", action: "edit_install", args: { op: "bracket", code: "BRAC15", unit_item_id: unit.id } },
        ] };
      }
      const p = live(code);
      if (!p) return { ok: false, message: `${code} is not in the active price books — nothing was changed.` };
      const qty = Number(cur?.quantity) || 1;
      const { unitSell: _u, ...f } = catalogLineFields(p, qty);
      const patch = { ...f, metadata: { ...(cur?.metadata || {}), ...f.metadata, ...tag("bracket") }, total_price: Number((qty * f.unit_price).toFixed(2)) };
      const ok = cur ? await d.updateItem(cur.id, patch) : await d.addItem({ ...patch, area_id: unit.area_id ?? null, parent_item_id: null, is_bundle: false, item_type: "product", sort_order: sortAfter, source: "mandy_voice", length: null, notes: null });
      if (ok === false || ok === null) return { ok: false, message: "Couldn't change the bracket — nothing was changed." };
      return done(`Bracket for ${unit.item_name} is now ${p.short_name || code} (${code}), ${spokenRand(f.unit_price * qty)}.`);
    }
    case "set_qty": return setQty(args.role, args.qty);
    case "add_bend": {
      const l = roleLine(d.items, unit.id, "drain_bend");
      return setQty("drain_bend", (Number(l?.quantity) || 0) + 1);
    }
    case "remove_roles": {
      const lines = installLinesOf(d.items, unit.id).filter((i) => args.roles.includes(installTag(i)!.role));
      if (!lines.length) return { ok: false, message: `${unit.item_name} has no ${args.what} — nothing was changed.` };
      const run = async (): Promise<MandyResult> => {
        for (const l of lines) await d.deleteItem(l.id);
        return done(`Removed the ${args.what} from ${unit.item_name}'s install (${lines.length} line${lines.length > 1 ? "s" : ""}).`);
      };
      return {
        ok: true,
        message: `Awaiting on-screen confirmation to remove the ${args.what}.`,
        confirm: { summary: `Remove the ${args.what} from ${unit.item_name}?`, lines: lines.map((l) => `${installLineLabel(l)} · ${spokenRand(Number(l.total_price) || (Number(l.quantity) || 1) * (Number(l.unit_price) || 0))}`), run },
      };
    }
  }
}

/** "Added Samsung 12K INV MW with standard install: 3 m kit, 450 bracket, trunking, end cap, drain, 3 elbows — R11 655,58 excl. VAT." */
export function announceInstall(unitName: string, r: { kitLength: number | null; kit: any; installLines: IItem[]; notes: string[]; line: any }, area?: string): string {
  const parts: string[] = [];
  if (r.kit) parts.push(`${r.kitLength ?? r.kit.length ?? 1} m kit`);
  for (const l of r.installLines) {
    const role = installTag(l)?.role;
    const q = Number(l.quantity) || 1;
    if (role === "bracket") { const s = String(l.item_name).match(/(\d{3})\s*mm/i); parts.push(`${/flatback/i.test(l.item_name) ? "flatback " : ""}${s ? s[1] + " " : ""}bracket`); }
    else if (role === "drain_bend") parts.push(`${q} elbow${q > 1 ? "s" : ""}`);
    else if (role) parts.push(q > 1 ? `${q} × ${ROLE_LABEL[role]}` : ROLE_LABEL[role]);
  }
  const total = [r.line, r.kit, ...r.installLines].filter(Boolean).reduce((s, i: any) => s + (Number(i.total_price) || (Number(i.quantity) || 1) * (Number(i.unit_price) || 0)), 0);
  const where = area ? ` to ${area}` : "";
  const head = parts.length > 1 ? `Added ${unitName}${where} with standard install: ${parts.join(", ")}` : parts.length ? `Added ${unitName}${where} with a ${parts[0]}` : `Added ${unitName}${where}`;
  return `${head} — ${spokenRand(total)} excl. VAT.${r.notes.length ? ` ${r.notes.join(". ")}.` : ""}`;
}

/** Compact install tags for Mandy's context: "Install[Samsung 12K·General]: kit 3m, BRAC01×1, TRUNK01×1(len)…" */
export function installContext(items: IItem[], areaName: (id?: string | null) => string): string {
  return unitsWithInstall(items).map((u) => {
    const ls = installLinesOf(items, u.id).map((l) => {
      const r = installTag(l)!.role;
      return r === "piping_kit" ? `kit ${Number(l.length) || 1}m` : `${r}:${l.item_number}×${Number(l.quantity) || 1}`;
    });
    return `Install[${u.item_name}·${areaName(u.area_id) || "No area"}]: ${ls.join(", ")}`;
  }).join(" | ");
}
