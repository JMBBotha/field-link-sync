// Screenshot harness, made-up "Example Estate" data only. Not shipped.
import "./index.css";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import ProjectView from "@/components/projects/ProjectView";
import { db } from "@/hooks/useProjectTracker";

const ago = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
const step = (hid: string, k: string, label: string, so: number, done: boolean) => ({ id: `${hid}-${k}`, house_id: hid, step_key: k, label, rate: 0, sort_order: so, done, paid: false });
const mk = (n: number, d: [boolean, boolean, boolean, boolean]) => {
  const id = `h${n}`;
  return { id, company_id: "c1", project_id: "p1", phase_id: null, house_no: String(n), po_number: "TEST-PO-1", make: "Samsung", unit_sizes: "24k + 3x12k", units_ordered: 4, units_received: d[2] ? 4 : 0, ready_for_aircon: false, ready_for_aircon_at: null, status_override: null, notes: null,
    steps: [step(id, "first_fit", "First fit (sleeves & drains)", 0, d[0]), step(id, "piping", "Install piping", 1, d[1]), step(id, "units", "Install units", 2, d[2]), step(id, "commissioning", "Commissioning", 3, d[3])] };
};
const T: [boolean, boolean, boolean, boolean][] = [[true,true,true,true],[true,true,true,false],[true,true,false,false],[true,false,false,false],[true,true,false,false],[true,false,false,false],[false,false,false,false],[true,true,true,true],[true,false,false,false],[false,false,false,false],[true,true,false,false],[true,false,false,false]];
const houses = T.map((d, i) => mk(61 + i, d));
const TOT = 76426.8;
const invoices = [
  { id: "i61", project_house_id: "h61", grand_total: TOT, status: "paid", invoice_number: "TEST-0001", sent_at: ago(120) },
  { id: "i62", project_house_id: "h62", grand_total: TOT, status: "partially_paid", invoice_number: "TEST-0002", sent_at: ago(75) },
  { id: "i63", project_house_id: "h63", grand_total: TOT, status: "sent", invoice_number: "TEST-0003", sent_at: ago(64) },
  { id: "i65", project_house_id: "h65", grand_total: TOT, status: "sent", invoice_number: "TEST-0004", sent_at: ago(34) },
  { id: "i68", project_house_id: "h68", grand_total: TOT, status: "paid", invoice_number: "TEST-0005", sent_at: ago(150) },
  { id: "i71", project_house_id: "h71", grand_total: TOT, status: "sent", invoice_number: "TEST-0006", sent_at: ago(8) },
  { id: "i72", project_house_id: "h72", grand_total: TOT, status: "draft", invoice_number: null, sent_at: null },
];
const payments = [{ invoice_id: "i61", amount: TOT, status: "completed" }, { invoice_id: "i62", amount: TOT / 2, status: "completed" }, { invoice_id: "i63", amount: TOT / 2, status: "completed" }, { invoice_id: "i68", amount: TOT, status: "completed" }];
const tables: Record<string, unknown> = {
  projects: { id: "p1", company_id: "c1", customer_id: "cu1", name: "Example Estate (TEST DATA)", code: "EX", po_number: "TEST-PO-1", default_make: "Samsung", status: "active", notes: null, created_at: ago(200), customers: { company_name: "Example Developer" } },
  project_phases: [{ id: "ph3", name: "Phase 3", house_from: 61, house_to: 90, sort_order: 1 }],
  project_houses: houses, invoices, payments,
};
// Fake query builder: every chain resolves to the canned table.
db.from = (t: string) => { const res = { data: tables[t] ?? [], error: null }; const q: Record<string, unknown> = {}; for (const m of ["select", "eq", "in", "order", "update", "insert"]) q[m] = () => q; q.maybeSingle = () => Promise.resolve(res); q.single = () => Promise.resolve(res); q.then = (r: (v: unknown) => unknown) => Promise.resolve(res).then(r); return q; };

const open = new URLSearchParams(location.search).get("house");
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient()}><MemoryRouter><ProjectView projectId="p1" /><Toaster /></MemoryRouter></QueryClientProvider>);
if (open) setTimeout(() => (document.querySelector(`[data-testid=house-grid] > div:nth-child(${open})`) as HTMLElement)?.click(), 1500);
