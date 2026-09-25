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
