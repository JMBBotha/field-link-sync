/**
 * Mandy action registry — the ONLY things the voice assistant can do.
 *
 * Schemas are sent to Grok (mandy-agent) as OpenAI-compatible tools. The
 * browser runs each action through handlers registered by the page that owns
 * the behaviour (same hooks/functions the buttons use), under the user's own
 * session. No handler here writes prices — pricing lives in src/lib/pricing.ts.
 */

export interface MandyChoice {
  label: string;
  action: string;
  args: Record<string, unknown>;
}

export interface MandyResult {
  ok: boolean;
  /** Short factual result — what actually happened. */
  message: string;
  data?: Record<string, unknown>;
  /** Low-confidence / multiple matches: user must tap one. Never a silent guess. */
  choices?: MandyChoice[];
  /** Destructive / outbound actions: run only after an on-screen tap. */
  confirm?: { summary: string; lines?: string[]; danger?: boolean; run: () => Promise<MandyResult> };
  /** false = the write/navigation ran but the refreshed screen didn't show it. */
  verified?: boolean;
}

export type MandyHandler = (args: Record<string, any>) => Promise<MandyResult>;

/** Never executed on voice alone — always an on-screen Confirm card. */
export const CONFIRM_REQUIRED = new Set(["remove_item", "remove_note", "remove_labour", "clear_quote", "run_plan", "send_quote", "email_quote", "whatsapp_quote", "delete_quote", "accept_quote", "create_deposit_invoice"]);

const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });

export const MANDY_ACTION_SCHEMAS: Record<string, { description: string; parameters: Record<string, unknown> }> = {
  open_last_quote: {
    description: "Open the most recent quote the user can see.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  open_latest_quote: {
    description: "Open the most recent quote, the same one that sits at the top of the Quotes list by default.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  open_top_quote: {
    description: "On the Quotes list: open the top row in the list's current sort and filters ('open the top one').",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  set_qty: {
    description: "Change a line's quantity on the open quote ('make the Samsung 2'). Kits/pipe lines change length in metres; labour changes hours.",
    parameters: { type: "object", properties: { item: str("Line as spoken, e.g. the Samsung, the kit in bedroom 1"), qty: num("New quantity / metres / hours") }, required: ["item", "qty"], additionalProperties: false },
  },
  set_line_price: {
    description: "Override one line's sell price excl. VAT ('set the Samsung price to 8000'). Never below the category markup floor; below list needs on-screen confirmation.",
    parameters: { type: "object", properties: { item: str("Line as spoken"), price: num("New unit sell price excl. VAT") }, required: ["item", "price"], additionalProperties: false },
  },
  move_item: {
    description: "Move a line to another area; a unit's kit moves with it.",
    parameters: { type: "object", properties: { item: str("Line as spoken"), area: str("Target area name") }, required: ["item", "area"], additionalProperties: false },
  },
  duplicate_area: {
    description: "Copy an area and all its lines (units, kits, labour; same stored prices) to a new area. Use for 'duplicate/copy X as Y'. Never use add_area for this.",
    parameters: { type: "object", properties: { area: str("Area to copy"), new_name: str("Name for the copy (optional)") }, required: ["area"], additionalProperties: false },
  },
  describe_area: {
    description: "Set a short description on an area. Use for 'describe X as …'. Never use rename_area for this.",
    parameters: { type: "object", properties: { area: str("Area name"), description: str("Description text") }, required: ["area", "description"], additionalProperties: false },
  },
  add_note: {
    description: "Add a note to the quote or to one line. Use for 'add a note …' / 'note: …'. Never use add_area for notes.",
    parameters: { type: "object", properties: { target: { type: "string", enum: ["quote", "item"], description: "quote or item" }, item: str("Line as spoken, when target is item"), text: str("Note text") }, required: ["target", "text"], additionalProperties: false },
  },
  edit_install: {
    description: "Edit the standard install of an AC unit by role: kit length ('make the piping 3 metres'), bracket ('use a 550 bracket', 'flatback bracket'), quantities ('2 end caps', '2 lengths of 100 by 40'), 'add a bend', or remove roles ('no drain', 'remove the small trunking', 'install without trunking' — Confirm card). Two units → the app shows chips. Trunking/drain are counted in supplier LENGTHS (1 × 3 m length), not metres.",
    parameters: { type: "object", properties: {
      op: { type: "string", enum: ["kit_length", "bracket", "set_qty", "add_bend", "remove_roles"], description: "Edit type" },
      metres: { type: "number", description: "Kit length in metres (kit_length)" },
      size: { type: "string", enum: ["450", "550", "650"], description: "Bracket size" },
      flatback: { type: "boolean", description: "Flatback bracket" },
      role: { type: "string", enum: ["trunking_main", "trunking_endcap", "trunking_small", "drain_pipe", "drain_bend"], description: "Role for set_qty" },
      qty: { type: "number", description: "Quantity (lengths or pieces)" },
      roles: { type: "array", items: { type: "string" }, description: "Roles to remove (remove_roles)" },
      what: str("Spoken name of what is removed, e.g. drain"),
    }, required: ["op"], additionalProperties: false },
  },
  clear_quote: {
    description: "Empty the open quote: remove every line (units, kits, labour) in one go ('clear the quote', 'remove everything', 'start over'). Room names are kept unless include_areas=true ('…and the rooms too'). Always an on-screen Confirm card; undoable. Never loop remove_item for this.",
    parameters: { type: "object", properties: { include_areas: { type: "boolean", description: "Also remove the rooms/areas (keeps the default area)" } }, additionalProperties: false },
  },
  remove_area: {
    description: "Remove an area (room) from the open quote. If it has lines, the app shows them on a Confirm card.",
    parameters: { type: "object", properties: { area: str("Area name") }, required: ["area"], additionalProperties: false },
  },
  remove_note: {
    description: "Remove a quote note or an area note/description ('remove the note'). Never use remove_item for notes. Needs on-screen confirmation; several notes → the app shows chips.",
    parameters: { type: "object", properties: { target: { type: "string", enum: ["quote", "area"], description: "quote or area (optional)" }, match: str("Words from the note, or the area name (optional)") }, additionalProperties: false },
  },
  edit_note: {
    description: "Replace the text of a quote note or an area note ('change the note to …'). Several notes → chips.",
    parameters: { type: "object", properties: { target: { type: "string", enum: ["quote", "area"], description: "quote or area (optional)" }, match: str("Words from the old note, or the area name (optional)"), text: str("New note text") }, required: ["text"], additionalProperties: false },
  },
  undo_last_change: {
    description: "Undo Mandy's last change to this draft quote ('undo', 'undo that', 'take that back', 'revert the last change'). Refused if the quote was edited by hand since.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  run_plan: {
    description: "USE THIS for ANY sentence with 2 or more edits (e.g. area + unit + kit length + labour). Several quote edits from ONE request, in order, shown on ONE confirm card. Each step is {action, args} using the other quote actions (add_area, add_item_to_area, set_kit_length, set_labour_hours, set_qty, set_line_price, move_item, remove_item, duplicate_area, rename_area, describe_area, add_note).",
    parameters: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          description: "Ordered steps",
          items: { type: "object", properties: { action: str("Action name"), args: { type: "object", description: "Arguments for that action" } }, required: ["action", "args"] },
        },
      },
      required: ["steps"],
      additionalProperties: false,
    },
  },
  open_quote: {
    description: "Open a quote by quote number (e.g. Q-2026-0020) or client name.",
    parameters: { type: "object", properties: { ref: str("Quote number"), client: str("Client name") }, additionalProperties: false },
  },
  find_client: {
    description: "Look up a client by name, phone or email.",
    parameters: { type: "object", properties: { query: str("Name, phone or email") }, required: ["query"], additionalProperties: false },
  },
  create_quote_for_client: {
    description: "Create a new draft quote for a client id returned by find_client, then open it.",
    parameters: { type: "object", properties: { client_id: str("Client id") }, required: ["client_id"], additionalProperties: false },
  },
  add_area: {
    description: "Add an empty area (room) to the open quote. Not for notes, descriptions or copies.",
    parameters: { type: "object", properties: { name: str("Area name, e.g. Main bedroom") }, required: ["name"], additionalProperties: false },
  },
  rename_area: {
    description: "Rename an area on the open quote. Not for descriptions.",
    parameters: { type: "object", properties: { area: str("Current area name"), new_name: str("New name") }, required: ["area", "new_name"], additionalProperties: false },
  },
  add_item_to_area: {
    description: "Add a catalog product to an area of the open quote. AC units automatically get their piping kit. If the user named no area, omit area (the app asks); never guess General.",
    parameters: {
      type: "object",
      properties: { area: str("Area name"), query: str("Product words as spoken, e.g. Samsung 24000 inverter"), quantity: num("Quantity, default 1") },
      required: ["query"],
      additionalProperties: false,
    },
  },
  set_kit_length: {
    description: "Set the piping kit length in metres (in an area, or the only kit on the quote).",
    parameters: { type: "object", properties: { area: str("Area name"), item: str("Kit as spoken, e.g. the 12K kit (optional)"), metres: num("Metres") }, required: ["metres"], additionalProperties: false },
  },
  set_labour_hours: {
    description: "Add to (mode=add) or set (mode=set) hourly labour on an area of the open quote, e.g. 'add 3 hours labour to main bedroom'. Also changes the labour RATE: 'make the labour rate 750' → {rate:750} (hours optional when rate is given). Hours in 0.5 steps; rate optional (defaults to the saved/standard rate).",
    parameters: { type: "object", properties: { area: str("Area name (optional when the quote has one labour row)"), hours: num("Hours (optional when only the rate changes)"), rate: num("Rate per hour excl. VAT (optional)"), mode: { type: "string", enum: ["add", "set"], description: "'add N hours' → add (increment); 'set / make it N hours' → set" } }, required: [], additionalProperties: false },
  },
  remove_labour: {
    description: "Remove the labour row from an area ('remove the labour from bedroom 1'), or every labour row with all=true ('remove all the labour'). Always an on-screen Confirm card. Never use remove_item for labour.",
    parameters: { type: "object", properties: { area: str("Area name"), all: { type: "boolean", description: "Remove labour from every area" } }, additionalProperties: false },
  },
  read_labour: {
    description: "Read out the labour on the open quote (hours, rate and total per area). Read-only.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  remove_item: {
    description: "Remove a line from the open quote (needs on-screen confirmation). Removing a unit asks whether to remove its kit too.",
    parameters: { type: "object", properties: { item: str("Line as spoken, name or product code") }, required: ["item"], additionalProperties: false },
  },
  generate_quote_pdf: {
    description: "Generate / download the PDF of the open quote.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  open_invoice: {
    description: "Open an invoice by invoice number or client name.",
    parameters: { type: "object", properties: { ref: str("Invoice number"), client: str("Client name") }, additionalProperties: false },
  },
  show_deposit_due: {
    description: "Read back the deposit due / paid state for the open quote, or a named quote. Read-only.",
    parameters: { type: "object", properties: { quote_ref: str("Quote number or client name; omit for the open quote") }, additionalProperties: false },
  },
  create_deposit_invoice: {
    description: "Create the deposit invoice for an accepted quote (always needs on-screen confirmation).",
    parameters: { type: "object", properties: { quote_ref: str("Quote number or client name; omit for the open quote") }, additionalProperties: false },
  },
  open_calendar_day: {
    description: "Open the schedule calendar on a day: today, tomorrow, a weekday, or a date like 3 October.",
    parameters: { type: "object", properties: { date: str("The day as spoken") }, required: ["date"], additionalProperties: false },
  },
  list_todays_jobs: {
    description: "List today's scheduled jobs.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  open_live_map: {
    description: "Open the live jobs map. If the user names a job status, pass it in status (or use filter_map_by_status).",
    parameters: { type: "object", properties: { status: str("Optional status as spoken, e.g. in progress") }, additionalProperties: false },
  },
  filter_map_by_status: {
    description: "Show only one job status on the live map (e.g. pending, claimed, in progress, completed).",
    parameters: { type: "object", properties: { status: str("Status as spoken") }, required: ["status"], additionalProperties: false },
  },
  read_quote_total: {
    description: "Read the open quote's totals.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
};

export function toolsFor(names: string[]) {
  return names
    .filter((n) => MANDY_ACTION_SCHEMAS[n])
    .map((n) => ({ type: "function", function: { name: n, ...MANDY_ACTION_SCHEMAS[n] } }));
}

export const fmtRand = (n: number) =>
  `R${Number(n || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/,/g, ".").replace(/\u00a0/g, " ")}`;
