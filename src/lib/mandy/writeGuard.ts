import type { MandyResult } from "./actions";

type Handler = (args: Record<string, any>) => Promise<MandyResult>;

export class WriteFailed extends Error {
  constructor(public what: string) { super(`Couldn't ${what} — nothing was changed.`); }
}

const LABELS = {
  addItem: "add the item", updateItem: "update the item", addArea: "add the area",
  updateArea: "update the area", deleteItem: "remove the item", moveItemToArea: "move the item",
} as const;
type Keys = keyof typeof LABELS;

/** Wrap quote writes so null/false results or throws raise WriteFailed. */
export function guardQuoteWrites<T extends Record<Keys, (...a: any[]) => Promise<any>>>(ctx: T): Pick<T, Keys> {
  const out = {} as Pick<T, Keys>;
  (Object.keys(LABELS) as Keys[]).forEach((k) => {
    (out as any)[k] = async (...a: any[]) => {
      let r: unknown;
      try { r = await ctx[k](...a); } catch { throw new WriteFailed(LABELS[k]); }
      if (r === null || r === false) throw new WriteFailed(LABELS[k]);
      return r;
    };
  });
  return out;
}

/** Any WriteFailed inside a handler (or its Confirm run) → ok:false with the honest message. */
export function withWriteFailures(hs: Record<string, Handler>): Record<string, Handler> {
  const safe = (h: () => Promise<MandyResult>) => h().catch((e) => {
    if (e instanceof WriteFailed) return { ok: false, message: e.message } as MandyResult;
    throw e;
  });
  return Object.fromEntries(Object.entries(hs).map(([n, h]) => [n, (args: Record<string, any>) => safe(async () => {
    const r = await h(args);
    if (r.confirm) { const run = r.confirm.run; return { ...r, confirm: { ...r.confirm, run: () => safe(run) } }; }
    return r;
  })]));
}
