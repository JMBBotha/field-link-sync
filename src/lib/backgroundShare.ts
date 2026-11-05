import { mayShareLocation, type ShareSnapshot } from "@/lib/availabilitySchedule";

export type BackgroundShareDeps = {
  start: () => Promise<void>;
  stop: () => Promise<void>;
};

let generation = 0;

/**
 * Start the Android foreground location service only while sharing is allowed.
 * Any other state stops it. A newer call cancels an in-flight start.
 */
export async function syncBackgroundShare(snapshot: ShareSnapshot, at: Date, deps: BackgroundShareDeps): Promise<"started" | "stopped"> {
  const gen = ++generation;
  if (!mayShareLocation(snapshot, at)) {
    await deps.stop();
    return "stopped";
  }
  await deps.start();
  if (gen !== generation) {
    await deps.stop();
    return "stopped";
  }
  return "started";
}

/** Test hook. Production calls never need to reset this. */
export function resetBackgroundShareGeneration() {
  generation = 0;
}
