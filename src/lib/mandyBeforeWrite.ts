import type { MandyHandler, MandyResult } from "@/lib/mandy/actions";

/**
 * Wrap Mandy handlers so each one (and each confirm.run) first awaits beforeWrite().
 * A string from beforeWrite blocks the write: { ok: false, message }. No beforeWrite → untouched.
 */
export function withBeforeWrite(
  hs: Record<string, MandyHandler>,
  beforeWrite?: () => Promise<string | null>,
): Record<string, MandyHandler> {
  if (!beforeWrite) return hs;
  const gate = async (run: () => Promise<MandyResult>): Promise<MandyResult> => {
    const refusal = await beforeWrite();
    if (typeof refusal === "string") return { ok: false, message: refusal };
    const r = await run();
    if (r?.confirm) {
      const inner = r.confirm.run;
      return { ...r, confirm: { ...r.confirm, run: () => gate(inner) } };
    }
    return r;
  };
  return Object.fromEntries(Object.entries(hs).map(([n, h]) => [n, (args: Record<string, any>) => gate(() => h(args))]));
}
