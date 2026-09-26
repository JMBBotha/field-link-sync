/**
 * Mandy session opener: greet once, then (and only then) open the mic.
 *
 * speak(onStarted) resolves when the greeting audio has ENDED. If it rejects,
 * or has not started within `timeoutMs`, we listen straight away so the user
 * is never left waiting. Cancelled (dock closed) → never start the mic.
 */
export interface GreetThenListenOpts {
  /** shouldPlay() returns false once the greeting was abandoned (timeout/cancel) — check right before playing. */
  speak: (onStarted: () => void, shouldPlay: () => boolean) => Promise<void>;
  startListening: () => void | Promise<void>;
  beep: () => void;
  isCancelled: () => boolean;
  /** Per-session flag: true after the first greeting; reset when the dock closes. */
  greeted: { current: boolean };
  timeoutMs?: number;
  /** Hard cap on the whole greeting once it has started. */
  maxGreetMs?: number;
}

export type GreetOutcome = "listened" | "listened-fallback" | "listened-no-greet" | "cancelled";

export async function greetThenListen(o: GreetThenListenOpts): Promise<GreetOutcome> {
  const listen = async (outcome: GreetOutcome): Promise<GreetOutcome> => {
    if (o.isCancelled()) return "cancelled";
    o.beep();
    await o.startListening();
    return outcome;
  };
  if (o.greeted.current) return listen("listened-no-greet");
  o.greeted.current = true;

  const timeoutMs = o.timeoutMs ?? 4000;
  const maxGreetMs = o.maxGreetMs ?? 12000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abandoned = false;
  const shouldPlay = () => !abandoned && !o.isCancelled();
  const result = await new Promise<"ended" | "fallback">((resolve) => {
    let started = false;
    timer = setTimeout(() => { if (!started) { abandoned = true; resolve("fallback"); } }, timeoutMs);
    o.speak(() => {
      started = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => resolve("ended"), maxGreetMs);
    }, shouldPlay).then(() => resolve("ended"), () => resolve("fallback"));
  });
  if (timer) clearTimeout(timer);
  return listen(result === "ended" ? "listened" : "listened-fallback");
}
