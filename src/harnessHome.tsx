import "./index.css";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import V8RoleHome from "@/components/v8/V8RoleHome";
import { MASSAIR_CT_ID, type HomeInvoice, type HomeJob, type HomePayment } from "@/lib/adminHomeCount";
const params = new URLSearchParams(location.search);
const linked = params.get("linked") !== "0";
const admin = params.get("home") === "admin";
const qc = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, enabled: false } } });
const A = "admin-demo";
const q = (n: number, num: string, status: string, total: number, extra: any = {}) => ({ id: `q${n}`, company_id: "co", status, total, created_at: "2026-10-10T08:00:00Z", sent_at: status !== "draft" ? "2026-10-12T08:00:00Z" : null, viewed_at: ["viewed", "accepted"].includes(status) ? "2026-10-13T08:00:00Z" : null, accepted_at: status === "accepted" ? "2026-10-20T08:00:00Z" : null, declined_at: null, updated_at: "2026-10-20T08:00:00Z", valid_until: "2026-11-30", lead_id: null, sales_engineer_id: A, quote_number: num, option_group_id: null, option_chosen_id: null, customer_name: `Demo Client ${n}`, customers: null, ...extra });
qc.setQueryData(["my-linked-admin", undefined], linked ? A : null);
const salesQuotes = [q(1, "Q-D-001", "draft", 39000), q(2, "Q-D-002", "draft", 82000), q(3, "Q-D-003", "viewed", 819000), q(4, "Q-D-004", "accepted", 9350), q(5, "Q-D-005", "accepted", 28600), q(6, "Q-D-006", "accepted", 21400), q(7, "Q-D-007", "accepted", 14000)];
const adminQuotes = salesQuotes.map((row) => ({
  ...row,
  company_id: MASSAIR_CT_ID,
  sent_at: row.status === "draft" ? null : "2026-11-01T08:00:00+02:00",
  viewed_at: row.status === "viewed" || row.status === "accepted" ? "2026-11-05T14:40:00+02:00" : null,
  accepted_at: row.status === "accepted" ? "2026-11-02T08:00:00+02:00" : null,
}));
qc.setQueryData(["pipeline"], {
  quotes: admin ? adminQuotes : salesQuotes,
  invoices: [{ quote_id: "q4", status: "paid", notes: "", grand_total: 9350 }, { quote_id: "q5", status: "partially_paid", notes: "", grand_total: 28600 }, { quote_id: "q6", status: "partially_paid", notes: "", grand_total: 21400 }],
  jobs: [{ quote_id: "q4", status: "scheduled", created_at: "2026-10-21T08:00:00Z" }, { quote_id: "q5", status: "scheduled", created_at: "2026-10-21T08:00:00Z" }, { quote_id: "q6", status: "completed", created_at: "2026-10-27T08:00:00Z" }],
  leads: [], laneByLead: {}, repName: { [A]: "Demo Admin" },
});
const figureSource = admin ? {
  invoices: [
    { id: "a", company_id: MASSAIR_CT_ID, status: "draft", grand_total: 18400, customer_name: "Client 5", invoice_number: "INV-D-021" },
    { id: "b", company_id: MASSAIR_CT_ID, status: "draft", grand_total: 15870, customer_name: "Client 8", invoice_number: "INV-D-022" },
    { id: "c", company_id: MASSAIR_CT_ID, status: "draft", grand_total: 8225.5, customer_name: "Client 2", invoice_number: "INV-D-023" },
    { id: "dep", company_id: MASSAIR_CT_ID, status: "sent", grand_total: 28000, sent_at: "2026-11-02T08:00:00+02:00", notes: "DEPOSIT — 50%", customer_name: "Client 7", invoice_number: "INV-DEP" },
    { id: "fin", company_id: MASSAIR_CT_ID, status: "sent", grand_total: 96000, sent_at: "2026-10-20T08:00:00+02:00", notes: "Balance", customer_name: "Client 4", invoice_number: "INV-FIN" },
  ] as HomeInvoice[],
  payments: [{ id: "p1", invoice_id: "fin", company_id: MASSAIR_CT_ID, amount: 19300, status: "paid", payment_date: "2026-11-04" }] as HomePayment[],
  credits: [],
  jobs: [
    ...Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, company_id: MASSAIR_CT_ID, job_type: "service", title: "Service", status: "scheduled", scheduled_for: "2026-11-03T08:00:00+02:00", customer_name: `Client ${i + 1}` })),
    ...Array.from({ length: 7 }, (_, i) => ({ id: `i${i}`, company_id: MASSAIR_CT_ID, job_type: "installation", title: "Installation", status: "scheduled", scheduled_for: "2026-11-04T08:00:00+02:00", customer_name: `Client ${i + 1}` })),
    ...Array.from({ length: 2 }, (_, i) => ({ id: `m${i}`, company_id: MASSAIR_CT_ID, job_type: "move", title: "Move", status: "scheduled", scheduled_for: "2026-11-05T08:00:00+02:00", customer_name: `Client ${i + 1}` })),
  ] as HomeJob[],
} : undefined;
createRoot(document.getElementById("root")!).render(<BrowserRouter><QueryClientProvider client={qc}><AuthProvider><div className="bg-[#EEF3F8] p-3 md:p-4"><V8RoleHome role={admin ? "admin" : "sales"} companyId={admin ? MASSAIR_CT_ID : undefined} figureSource={figureSource} /></div></AuthProvider></QueryClientProvider></BrowserRouter>);
if (admin && params.get("sheet") === "waiting") {
  window.setTimeout(() => document.querySelector<HTMLButtonElement>("[aria-label='How invoices waiting was counted']")?.click(), 300);
}
