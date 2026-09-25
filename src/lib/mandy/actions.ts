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
  confirm?: { summary: string; run: () => Promise<MandyResult> };
  /** false = the write/navigation ran but the refreshed screen didn't show it. */
  verified?: boolean;
}

export type MandyHandler = (args: Record<string, any>) => Promise<MandyResult>;

/** Never executed on voice alone — always an on-screen Confirm card. */
export const CONFIRM_REQUIRED = new Set(["remove_item", "run_plan", "send_quote", "email_quote", "whatsapp_quote", "delete_quote", "accept_quote", "create_deposit_invoice"]);

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
  run_plan: {
    description: "Several quote edits from ONE request, in order, shown on ONE confirm card. Each step is {action, args} using the other quote actions (add_area, add_item_to_area, set_kit_length, set_labour_hours, set_qty, set_line_price, move_item, remove_item, duplicate_area, rename_area, describe_area, add_note).",
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
    parameters: { type: "object", properties: { area: str("Area name"), metres: num("Metres") }, required: ["metres"], additionalProperties: false },
  },
  set_labour_hours: {
    description: "Add to (mode=add) or set (mode=set) hourly labour on an area of the open quote, e.g. 'add 3 hours labour to main bedroom'. Hours in 0.5 steps; rate optional (defaults to the saved/standard rate).",
    parameters: { type: "object", properties: { area: str("Area name"), hours: num("Hours"), rate: num("Rate per hour excl. VAT (optional)"), mode: { type: "string", enum: ["add", "set"], description: "'add N hours' → add (increment); 'set / make it N hours' → set" } }, required: ["area", "hours", "mode"], additionalProperties: false },
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
