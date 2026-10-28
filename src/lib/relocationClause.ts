/**
 * "Existing / relocated units" clause (Johan 2026-10-28, approved pt1867u).
 * One company-wide wording (company_terms.relocation_clause, editable by the main admin only);
 * this constant is the fallback when the record can't be read.
 * Shown on a quote when quotes.relocation_clause = 'on', hidden when 'off', and auto-detected when NULL.
 * Quotes already sent/viewed/accepted on 28 Oct were frozen to 'off' by the migration.
 */
export const RELOCATION_HEADING = "Existing / relocated units:";
export const RELOCATION_CLAUSE_DEFAULT =
  "This quote includes removing and relocating existing air conditioning units. The age, condition and internal state of these units, including compressors, electronics and other components, are unknown to us. Massair CT (Pty) Ltd will take the utmost care and follow correct procedures when removing, relocating, servicing and recommissioning them, but we cannot guarantee their condition, functionality or performance. Should any existing unit fail or not function correctly after relocation, whether immediately or at a later stage, this is not the responsibility of Massair CT (Pty) Ltd and the risk remains with the client. Any repairs or replacement parts required on existing units will be quoted separately.";

export type RelocationMode = "on" | "off" | null | undefined;

/** Removal / relocation / reinstall wording (catalogue services "Removal of existing air conditioner",
 *  "Removal and reinstallation of existing air conditioner", labour norms removal / removal_reinstall). */
const ACTION = /\b(remov\w*|relocat\w*|re-?install\w*|re-?instat\w*|de-?install\w*|uninstall\w*|decommission\w*|re-?commission\w*|re-?locat\w*)/i;
/** The thing moved must be an AC unit, not ducting / diffusers / grilles. */
const UNIT = /\b(units?|air\s*-?\s*con\w*|aircon\w*|a\/c|acs?|cassettes?|splits?|indoors?|outdoors?|condensers?|compressors?|heat\s*pumps?|fcus?|ahus?|midwalls?|mid-walls?|under\s*ceilings?|consoles?|ducted\s+units?)\b/i;

/** True when one quote line describes removing/relocating/reinstalling an existing AC unit. */
export function isRelocationLine(text: string | null | undefined): boolean {
  const t = (text || "").replace(/\s+/g, " ");
  return ACTION.test(t) && UNIT.test(t);
}

export function quoteHasRelocation(lines: Array<string | null | undefined>): boolean {
  return lines.some(isRelocationLine);
}

/** Final decision: admin override wins, otherwise auto-detect from the quote lines. */
export function showRelocationClause(mode: RelocationMode, lines: Array<string | null | undefined>): boolean {
  if (mode === "on") return true;
  if (mode === "off") return false;
  return quoteHasRelocation(lines);
}
