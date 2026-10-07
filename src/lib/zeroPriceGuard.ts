// R0 guard: a named line priced R0 blocks save/send (invoice, proposal, quote).
type T = (t: { title: string; description: string; variant: "destructive" }) => unknown;
export const r0Line = (ls: { n?: string | null; p?: unknown }[]) => ls.find((l) => String(l.n ?? "").trim() && !Number(l.p))?.n?.trim() ?? null;
export const r0Msg = (n: string) => `Enter a price for ${n}`;
const blk = (n: string | null, t: T) => { if (n) t({ title: "Price missing", description: r0Msg(n), variant: "destructive" }); return !!n; };
export const blockR0 = (ls: { description?: string | null; rate?: unknown }[], t: T) => blk(r0Line(ls.map((l) => ({ n: l.description, p: l.rate }))), t);
// A bundle item with no live model match sits inside a kit as "Not found: <model> – remap" (lib/bundleResolve.ts): treated as an unpriced line.
const kitNotFound = (ls: { metadata?: any }[]) => {
  for (const l of ls) for (const k of (l?.metadata?.kit?.items ?? []) as any[]) if (String(k?.name ?? "").startsWith("Not found: ")) return String(k.name);
  return null;
};
export const r0Quote = (ls: { item_name?: string | null; unit_price?: unknown; parent_item_id?: string | null; metadata?: any }[]) =>
  r0Line(ls.filter((l) => !l.parent_item_id).map((l) => ({ n: l.item_name, p: String(l.item_name ?? "").startsWith("Not found: ") ? 0 : l.unit_price })))
  ?? kitNotFound(ls);
export const blockR0Quote = (ls: Parameters<typeof r0Quote>[0], t: T) => blk(r0Quote(ls), t);
