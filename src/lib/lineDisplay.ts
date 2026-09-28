/**
 * Staff line readability — DISPLAY ONLY. Never rewrites item_name, never
 * changes quantity/price/totals. Used by the staff estimate editor.
 */
export interface DisplayLine {
  item_name: string;
  quantity: number;
  unit_price?: number;
  metadata?: any;
}

const num = (n: number) => String(Math.round((Number(n) || 0) * 100) / 100);

/** Supplier length of one item: metadata first, else "15.24 mtr" / "(1.8mtr)" in the name. */
function lengthOfOne(line: DisplayLine): number | null {
  const m = Number(line.metadata?.supplier_length_m);
  if (Number.isFinite(m) && m > 0) return m;
  const n = (line.item_name || "").match(/(\d+(?:\.\d+)?)\s*mtr\b/i);
  return n ? Number(n[1]) : null;
}

/** Kit metres: explicit length, else sell ÷ per-metre sell (kits are priced per metre). */
export function kitMetres(line: DisplayLine): number | null {
  const k = line.metadata?.kit;
  if (!k) return null;
  const explicit = Number(k.length_m ?? k.length ?? line.metadata?.length_m ?? line.metadata?.length);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const per = Number(k.unit_sell);
  const total = (Number(line.quantity) || 0) * (Number(line.unit_price) || 0);
  if (per > 0 && total > 0) return Math.round((total / per) * 10) / 10;
  return null;
}

export function qtyLabel(line: DisplayLine): string {
  const q = Number(line.quantity) || 0;
  const md = line.metadata || {};
  if (md.labour) return `${num(md.hours ?? q)} h`;
  if (md.kit) {
    const m = kitMetres(line);
    return m != null ? `${num(m)} m` : `${num(q)} each`;
  }
  if (md.qty_unit === "metre") return `${num(q)} m`;
  const L = lengthOfOne(line);
  if (L) return `${num(q)} × ${num(L)} m length`;
  return `${num(q)} each`;
}

const size = (name: string) => {
  const m = name.match(/(\d+)\s*x\s*(\d+)/i);
  return m ? `${m[1]}×${m[2]}` : "";
};
const mm = (name: string) => name.match(/(\d+)\s*mm/i)?.[1] ?? "";

/** Metres of a length-sold line: qty × one length when counted in lengths, else qty. */
function lineMetres(line: DisplayLine): number {
  const q = Number(line.quantity) || 0;
  if (line.metadata?.qty_unit === "metre") return q;
  const L = lengthOfOne(line);
  return L ? q * L : q;
}

/** Short, size-clear display name for standard-install companions (null = keep the saved name). */
export function shortInstallName(line: DisplayLine): string | null {
  const name = line.item_name || "";
  const md = line.metadata || {};
  if (md.labour) return "Labour";
  const role = md.install?.role as string | undefined;
  const join = (...p: string[]) => p.filter(Boolean).join(" ");
  switch (role) {
    case "bracket":
      return join(/flat/i.test(name) ? "Flatback bracket" : "Wall bracket", mm(name));
    case "trunking_main":
    case "trunking_small":
      return `${join("Trunking", size(name))} · ${num(lineMetres(line))} m`;
    case "trunking_endcap":
      return join("End cap", size(name));
    case "drain_pipe":
      return `${join("Drain pipe", mm(name) && `${mm(name)} mm`)} · ${num(lineMetres(line))} m`;
    case "drain_bend":
      return join("Drain elbow", mm(name) && `${mm(name)} mm`);
    default:
      return null;
  }
}

/** 'Piping kit 1/4 + 1/2 · 3 m' from the copper contents, else the kit name. */
export function kitTitleFromMetadata(line: DisplayLine): string | null {
  const k = line.metadata?.kit;
  if (!k) return null;
  const items: any[] = Array.isArray(k.items) ? k.items : [];
  let sizes = items
    .map((i) => String(i?.name || ""))
    .filter((n) => /copper/i.test(n))
    .map((n) => n.match(/(\d+\/\d+)\s*(?:inch|")/i)?.[1])
    .filter(Boolean) as string[];
  if (!sizes.length) {
    const m = String(k.name || line.item_name || "").match(/(\d+\/\d+)\s*[&+]\s*(\d+\/\d+)/);
    if (m) sizes = [m[1], m[2]];
  }
  const metres = kitMetres(line);
  const head = sizes.length ? `Piping kit ${sizes.join(" + ")}` : "Piping kit";
  return metres != null ? `${head} · ${num(metres)} m` : head;
}

/** Read-only kit contents for the expanded view. */
export function kitContents(line: DisplayLine): { name: string; qty: string }[] {
  const items: any[] = Array.isArray(line.metadata?.kit?.items) ? line.metadata.kit.items : [];
  return items.map((i) => ({
    name: String(i?.name || i?.code || "Item").replace(/^([^-]+) - \1\s*/i, "$1 "),
    qty: i?.quantity != null ? num(Number(i.quantity)) : "",
  }));
}
