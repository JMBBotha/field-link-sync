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
export const CONFIRM_REQUIRED = new Set(["remove_item", "send_quote", "email_quote", "whatsapp_quote", "delete_quote", "accept_quote", "create_deposit_invoice"]);

const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });

export const MANDY_ACTION_SCHEMAS: Record<string, { description: string; parameters: Record<string, unknown> }> = {
  open_last_quote: {
    description: "Open the most recent quote the user can see.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
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
    description: "Add an area (room) to the open quote.",
    parameters: { type: "object", properties: { name: str("Area name, e.g. Main bedroom") }, required: ["name"], additionalProperties: false },
  },
  rename_area: {
    description: "Rename an area on the open quote.",
    parameters: { type: "object", properties: { area: str("Current area name"), new_name: str("New name") }, required: ["area", "new_name"], additionalProperties: false },
  },
  add_item_to_area: {
    description: "Add a catalog product to an area of the open quote. AC units automatically get their piping kit.",
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
    description: "Remove a line from the open quote (needs on-screen confirmation).",
    parameters: { type: "object", properties: { item: str("Line name or product code") }, required: ["item"], additionalProperties: false },
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
