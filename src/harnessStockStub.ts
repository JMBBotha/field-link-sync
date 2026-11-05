// Test-harness stand-in for the Supabase client. Screenshot runs only.
// Every call stays in this file. Nothing is sent to the live project.
import { supabase } from "@/integrations/supabase/client";

export const CO = "00000000-0000-0000-0000-0000000000c1";
export const view = new URLSearchParams(location.search).get("v") || "01";

export const products = [
  { id: "p1", product_code: "FCMI-24", short_name: "Test Midwall 24K", name: "Test Midwall 24K pair", description: "", price_per_unit_label: "each", sold_in_length: false, unit_length: null, cost_price: 10434.09, product_type: "ac_unit" },
  { id: "p2", product_code: "G005", short_name: "R410a 11.3kg", name: "GAS - R410 DISP 11.3KG", description: "", price_per_unit_label: "kg", sold_in_length: false, unit_length: null, cost_price: 2260, product_type: "material" },
  { id: "p3", product_code: "CU-14-15", short_name: "Copper pipe 1/4", name: "Copper pipe 1/4 15m coil", description: "", price_per_unit_label: "m", sold_in_length: false, unit_length: 15, cost_price: 610, product_type: "material" },
  { id: "p6", product_code: "SPARE-18", short_name: "Test spare 18K", name: "Test spare 18K", description: "", price_per_unit_label: "each", sold_in_length: false, unit_length: null, cost_price: 4200, product_type: "ac_unit" },
];

export const jobs = [
  { id: "j1", title: "Install · job j1", status: "scheduled", quote_id: null, company_id: CO },
  { id: "j2", title: "Service · job j2", status: "scheduled", quote_id: null, company_id: CO },
];

const testDoc = {
  id: "00000000-0000-0000-0000-00000000dd01",
  company_id: CO,
  supplier_id: null,
  supplier_name: "Test Supplies",
  suppliers: null,
  doc_type: "delivery_note",
  doc_number: "TST-DN0001",
  po_number: "TST-SO0099",
  doc_date: "2026-11-05",
  file_name: null,
  storage_path: null,
  source: "upload",
  notes: null,
  created_at: "2026-11-05T08:00:00Z",
  supplier_job_document_lines: [
    { id: "l1", line_no: 1, description: "IN - TEST MIDWALL INVERTER 24000", model_number: "FCMI-24-P", serial_number: null, qty: 1, job_id: null, unit_detail_id: null, received_at: null },
    { id: "l2", line_no: 2, description: "OUT - TEST MIDWALL INVERTER 24000", model_number: "FCMI-24X-P", serial_number: null, qty: 1, job_id: null, unit_detail_id: null, received_at: null },
    { id: "l3", line_no: 3, description: "GAS - R410 DISP 11.3KG", model_number: "G005", serial_number: null, qty: 2, job_id: null, unit_detail_id: null, received_at: null },
  ],
  supplier_job_document_links: [],
};

function hand() {
  const cu = { bucket: "material_pool", stock_item_id: "s-cu", item_label: "Copper test", qty: 4, value_excl: 40 };
  if (view === "02") return [cu];
  if (view === "03") return [{ ...cu, value_excl: 48 }];
  if (view === "05") return [{ bucket: "material_pool", stock_item_id: "s-w", item_label: "Widget", qty: 3, value_excl: 60 }];
  if (view === "08a") return [{ bucket: "job_unit", stock_item_id: "s-u", item_label: "Test Midwall 24K · indoor", qty: 1, value_excl: 130 }];
  if (view === "08b") return [{ ...cu, value_excl: 48 }];
  if (view === "09") return [{ ...cu, value_excl: 48 }];
  return [];
}

function rowsFor(table: string) {
  if (table === "supplier_products") return products;
  if (table === "jobs") return jobs;
  if (table === "supplier_job_documents") return [testDoc];
  if (table === "supplier_job_document_lines") return testDoc.supplier_job_document_lines;
  return [];
}

function query(table: string) {
  const data = rowsFor(table);
  const done = Promise.resolve({ data, error: null });
  const api: Record<string, unknown> = {};
  for (const m of ["select", "eq", "neq", "in", "order", "limit", "update", "insert"]) api[m] = () => api;
  api.maybeSingle = () => Promise.resolve({ data: data[0] ?? null, error: null });
  api.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => done.then(res, rej);
  return api;
}

const user = {
  id: "00000000-0000-0000-0000-0000000000aa",
  email: "stock-test@example.test",
  aud: "authenticated",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-11-05T00:00:00Z",
};

const session = { user, access_token: "harness", token_type: "bearer", expires_in: 3600, expires_at: 9999999999, refresh_token: "harness" };

const sb = supabase as unknown as {
  rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  from: (table: string) => unknown;
  auth: {
    getSession: () => Promise<{ data: { session: typeof session }; error: null }>;
    onAuthStateChange: (cb: (event: string, session: typeof session) => void) => { data: { subscription: { unsubscribe: () => void } } };
  };
  functions: { invoke: (name: string) => Promise<{ data: null; error: { message: string } }> };
};

sb.rpc = async (name, args) => {
  if (name === "caller_company_id") return { data: CO, error: null };
  if (name === "cf_can_receive") return { data: true, error: null };
  if (name === "me_needs_password") return { data: false, error: null };
  if (name === "admin_bot_accounts") return { data: [], error: null };
  if (name === "sjd_search") return { data: [{ document_id: testDoc.id }], error: null };
  if (name === "stock_on_hand") return { data: hand(), error: null };
  if (name === "stock_general_units") return { data: [], error: null };
  if (name === "stock_awaiting") return { data: view === "04" ? [{ item_label: "Widget", qty: 3, doc_number: "TST-INV-W" }] : [], error: null };
  if (name === "material_allowance_seed_stubs") return { data: 1, error: null };
  if (name === "job_units_for_tech") return { data: [{ id: "u1", half: "indoor", supplier_code: "FCMI-24-P", serial_no: null, label: "Test Midwall 24K" }], error: null };
  if (name === "sjd_receive") {
    const lines = (args?.p_lines as { qty_packs?: number }[] | undefined) ?? [];
    const qty = lines.reduce((s, l) => s + Math.abs(Number(l.qty_packs ?? 0)), 0);
    if (qty > 1) return { data: null, error: { message: "Credit of 2 is more than the 1 still received" } };
    return { data: { stocked: 0, cost_only: 0, returned: qty, reserved: 0 }, error: null };
  }
  return { data: null, error: { message: `Harness blocked ${name}. No live call was made.` } };
};

sb.from = (table: string) => query(table);
sb.auth.getSession = async () => ({ data: { session }, error: null });
sb.auth.onAuthStateChange = () => ({ data: { subscription: { unsubscribe() {} } } });
sb.functions.invoke = async (name: string) => ({ data: null, error: { message: `Harness blocked ${name}` } });
