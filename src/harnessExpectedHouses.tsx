/** Demo of expected-money house rows and the liabilities list. Not live Massair. */
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import { YardMoneyStrip } from "@/components/v8/roleHome/YardHome";
import { MASSAIR_CT_ID } from "@/lib/adminHomeCount";
import type { Allocation, Commitment, Receipt } from "@/lib/cashHealth";
import { payExpectSettings, type ExpectContext } from "@/lib/expectedPayDates";
import { buildYardHome } from "@/lib/yardView";

const CT = MASSAIR_CT_ID;
const params = new URLSearchParams(window.location.search);
const dark = params.get("theme") === "dark";
const shot = params.get("shot") === "liabilities" ? "liabilities" : "money";
if (dark) document.documentElement.classList.add("dark");

const expect: ExpectContext = {
  settings: payExpectSettings(null),
  houses: [
    { id: "h1", projectId: "sv", houseNo: "17528", unit: "Unit A" },
    { id: "h2", projectId: "sv", houseNo: "17529" },
    { id: "h4", projectId: "sv", houseNo: "17533" },
    { id: "h5", projectId: "sv", houseNo: "17534" },
    { id: "a1", projectId: "avec", houseNo: "12" },
  ],
  projects: [
    { id: "sv", customerId: "c", name: "Stellenbosch Village", code: "SV" },
    { id: "avec", customerId: "a", name: "AVEC", code: "AVEC" },
  ],
  projectOverrides: [
    { projectId: "sv", timing: "project", dateMode: "day_of_month", depositDays: null, finalDays: null, windowExtraDays: null, dayOfMonth: 15, monthOffset: 1 },
    { projectId: "avec", timing: "project", dateMode: "month_end", depositDays: null, finalDays: null, windowExtraDays: null, dayOfMonth: null, monthOffset: 0 },
  ],
  invoiceOverrides: [],
  jobs: [{ id: "j-rita", quoteId: "q-rita", completedAt: "2026-11-02T10:00:00+02:00", title: "Service" }],
  quotes: [],
  defaultDepositPct: 50,
  coverage: [
    { invoiceId: "cover", projectHouseId: "h4", scope: "balance", amountIncl: 40000 },
    { invoiceId: "cover", projectHouseId: "h5", scope: "balance", amountIncl: 40000 },
  ],
};

const invoices = [
  { id: "d1", company_id: CT, status: "paid", sent_at: "2026-10-20", grand_total: 45000, notes: "DEPOSIT", invoice_number: "D-17528", customer_name: "Cape Estates", project_house_id: "h1", issue_date: "2026-10-20" },
  { id: "f1", company_id: CT, status: "sent", sent_at: "2026-11-13", grand_total: 65358.21, notes: "Final", invoice_number: "F-17528", customer_name: "Cape Estates", project_house_id: "h1", issue_date: "2026-11-13" },
  { id: "d2", company_id: CT, status: "sent", sent_at: "2026-11-01", grand_total: 40000, notes: "DEPOSIT", invoice_number: "D-17529", customer_name: "Cape Estates", project_house_id: "h2", issue_date: "2026-11-01" },
  { id: "d3", company_id: CT, status: "sent", sent_at: "2026-09-20", grand_total: 18000, notes: "DEPOSIT", invoice_number: "D-17533", customer_name: "Cape Estates", project_house_id: "h4", issue_date: "2026-09-20" },
  { id: "cover", company_id: CT, status: "sent", sent_at: "2026-11-10", grand_total: 80000, notes: "Final", invoice_number: "F-COVER", customer_name: "Cape Estates", project_house_id: null, issue_date: "2026-11-10" },
  { id: "av", company_id: CT, status: "sent", sent_at: "2026-10-05", grand_total: 15000, notes: "DEPOSIT", invoice_number: "AV-DEP", customer_name: "Avec Holdings", project_house_id: "a1", issue_date: "2026-10-05" },
  { id: "nd", company_id: CT, status: "paid", sent_at: "2026-10-20", grand_total: 3000, notes: "DEPOSIT", invoice_number: "N-DEP", customer_name: "Rita Nkosi", quote_id: "q-rita", issue_date: "2026-10-20" },
  { id: "nf", company_id: CT, status: "sent", sent_at: "2026-11-01", grand_total: 7000, notes: "Final", invoice_number: "N-FIN", customer_name: "Rita Nkosi", quote_id: "q-rita", issue_date: "2026-11-01" },
];
const payments = [
  { invoice_id: "d1", amount: 45000, status: "paid", payment_date: "2026-11-02" },
  { invoice_id: "d2", amount: 20000, status: "paid", payment_date: "2026-11-10" },
  { invoice_id: "nd", amount: 3000, status: "paid", payment_date: "2026-10-28" },
];

const deposit = (id: string, invoice: string, client: string): Receipt => ({
  id, source: "field_lynk", invoice_id: invoice, quote_id: null, ref: invoice, client,
  part: "deposit", amount_incl: 10000, vat_incl: 0, expected_date: null, leeway_days: 0, confidence: 100,
  status: "received", received_date: "2026-11-01", note: null,
});
const unit = (over: Partial<Commitment> & { id: string }): Commitment => ({
  source_key: null, invoice_id: "f1", quote_id: null, job_id: "job-h1", project: "F-17528 Cape Estates",
  item: "AR3000 · Unit", kind: "unit", qty: 1, supplier: "Samsung", unit_cost_excl: 4646.96, vat_rate: 15,
  status: "needed", pay_date: "2026-11-09", note: null, ...over,
});
const commitments: Commitment[] = [
  unit({ id: "c1", invoice_id: "f1", job_id: "job-h1" }),
  unit({ id: "c2", invoice_id: "f1", job_id: "job-h1", item: "AR40H18C1AMN/AMX · Indoor", qty: 1, unit_cost_excl: 2200, pay_date: "2026-11-16" }),
  unit({ id: "c3", invoice_id: "cover", job_id: null, project: "F-COVER Cape Estates", item: "Copper 1/4 · Piping", kind: "material", qty: 12, supplier: "One Stop Shop", unit_cost_excl: 80, pay_date: "2026-11-20" }),
  unit({ id: "c4", invoice_id: "nf", job_id: "j-rita", project: "N-FIN Rita Nkosi", item: "R410", kind: "material", qty: 2, supplier: null, unit_cost_excl: 450, pay_date: null }),
];
const receipts: Receipt[] = [
  deposit("r1", "f1", "Cape Estates"),
  deposit("r2", "cover", "Cape Estates"),
  deposit("r3", "nf", "Rita Nkosi"),
];
const allocations: Allocation[] = [{ id: "a", stock_item_id: "s", commitment_id: "c2", qty: 0, drawn_at: null }];

const model = buildYardHome({
  companyId: CT,
  now: new Date("2026-11-16T12:00:00+02:00"),
  invoices,
  payments,
  jobs: [{ id: "j-rita", company_id: CT, status: "completed", title: "Service — 14 Beach Road", customer_name: "Rita Nkosi", address: "14 Beach Road, Sea Point", job_type: "service" }],
  expect,
  bankState: "ready",
  bank: { accounts: [{ id: "a", label: "Current", account_ref: null, include: true, sort: 1 }], balances: [{ id: "b", account_id: "a", balance: 186400, as_of: "2026-11-15", created_at: "2026-11-15T08:00:00Z" }] },
  booksState: "ready",
  books: { receipts, commitments, allocations },
});

function Harness() {
  return (
    <main className="shot" style={{ width: 834, margin: "0 auto", padding: 16 }}>
      <style>{`.shot .money-houses { max-height: none; }`}</style>
      <p style={{ margin: "0 0 10px", padding: "6px 12px", background: "#0F1B2A", color: "#fff", fontSize: 12, fontWeight: 700 }}>
        Demo — harness, not live Massair. {dark ? "Dark mode." : "Light mode."} {shot === "liabilities" ? "Liabilities." : "Expected money."}
      </p>
      <YardMoneyStrip model={model} startPanel={shot === "liabilities" ? "liabilities" : "deposits"} startCombined={shot === "money"} />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <Harness />
  </BrowserRouter>,
);
