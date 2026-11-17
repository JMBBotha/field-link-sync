/** Which reminder is due for a service visit that still has no technician. */
export type AlertLevel = "now" | "h48" | "h24";

const HOUR = 60 * 60 * 1000;

/**
 * Immediate, then once inside the 48-hour window, then once inside the 24-hour window.
 * A level already sent is skipped. Nothing is sent after the visit has started.
 * The immediate notice is still due when the visit is in the future, even inside 24 hours.
 */
export function dueAlertLevels(start: Date, now: Date, sent: readonly AlertLevel[] = []): AlertLevel[] {
  const have = new Set(sent);
  const out: AlertLevel[] = [];
  const push = (level: AlertLevel) => {
    if (!have.has(level)) out.push(level);
  };
  const ms = start.getTime() - now.getTime();
  if (!(ms > 0)) return out;
  push("now");
  if (ms <= 48 * HOUR && ms > 24 * HOUR) push("h48");
  if (ms <= 24 * HOUR) push("h24");
  return out;
}

/** One alert per visit, level and person. A second call with the same key is a no-op. */
export function alertKey(scheduleId: string, level: AlertLevel, userId: string): string {
  return `${scheduleId}:${level}:${userId}`;
}

export function rememberAlert(sent: Set<string>, scheduleId: string, level: AlertLevel, userId: string): boolean {
  const key = alertKey(scheduleId, level, userId);
  if (sent.has(key)) return false;
  sent.add(key);
  return true;
}

/**
 * A service visit with nobody, or with a salesperson sitting in the technician slot,
 * still needs a technician. Sales visits do not.
 */
export function scheduleNeedsTechnician(
  lane: string | null | undefined,
  agentId: string | null | undefined,
  techIds: ReadonlySet<string>,
): boolean {
  if (lane === "sales") return false;
  if (!agentId) return true;
  return !techIds.has(agentId);
}
