import type { LeadStatusFilter } from "@/components/StatusFilterButtons";

/** Real map status values and their on-screen labels (StatusFilterButtons). */
export const MAP_STATUSES: { value: LeadStatusFilter; label: string }[] = [
  { value: "pending", label: "Available" },
  { value: "accepted", label: "Claimed" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
];

const WORDS: [RegExp, LeadStatusFilter][] = [
  [/\b(pending|available|open|new|unassigned|unclaimed)\b/, "pending"],
  [/\b(claimed|accepted|assigned|booked)\b/, "accepted"],
  [/\b(in[ _-]?progress|busy|on ?site|working|started|active)\b/, "in_progress"],
  [/\b(completed?|done|finished|closed)\b/, "completed"],
];

/** Spoken status word → real value, or null when it isn't a map status (e.g. "emergency"). */
export function mapSpokenStatus(word: string): LeadStatusFilter | null {
  const t = (word || "").toLowerCase().trim();
  for (const [re, v] of WORDS) if (re.test(t)) return v;
  return null;
}

/** The real Live Map page (sidebar "Live Tracking", bottom-nav "Map"). */
export const LIVE_MAP_ROUTE = "/admin/map";

/**
 * filter_map_by_status from any page: navigate to the Live Map with ?status=,
 * which AdminMapPage applies to the same filter state as its status chips.
 */
export function makeMapHandlers(navigate: (to: string) => void) {
  return {
    open_live_map: async () => {
      navigate(LIVE_MAP_ROUTE);
      return { ok: true, message: "Opened the live map." };
    },
    filter_map_by_status: async ({ status }: Record<string, unknown>) => {
      const v = mapSpokenStatus(String(status || ""));
      if (!v) {
        return {
          ok: true,
          message: `“${status}” isn't a map status. Waiting for the user to tap one.`,
          choices: MAP_STATUSES.map((m) => ({ label: m.label, action: "filter_map_by_status", args: { status: m.value } })),
        };
      }
      navigate(`${LIVE_MAP_ROUTE}?status=${v}`);
      const label = MAP_STATUSES.find((m) => m.value === v)!.label;
      return { ok: true, message: `Map now shows only ${label} jobs.` };
    },
  };
}
