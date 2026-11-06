/** Demo harness for screenshots. Figures are sample rows, not live Massair CT totals. */
import "./index.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { CashFlowPieCard } from "@/components/v8/AdminHomeCashFlowPie";
import { StockGlanceCard } from "@/components/v8/AdminHomeStockGlance";
import PaymentSchedulePanel, { type PaySchedule } from "@/components/invoicing/PaymentSchedulePanel";
import type { CashFlowGlance } from "@/lib/adminHomeCashFlow";
import type { StockGlance } from "@/lib/adminHomeStockGlance";

const cash: CashFlowGlance = {
  invoices: 3,
  moneyIn: 48000,
  liability: 22000,
  expectedFinals: 36000,
  netCover: 62000,
  uncostedUnits: 1,
  moneyLines: [
    { id: "i1", invoiceId: "i1", label: "INV-1042 · Ndlovu", detail: "Deposit or part payment in", amount: 28000, href: "/admin/invoices/i1#expected-final", jobHref: "/admin/jobs/j1", jobLabel: "House 12" },
    { id: "i2", invoiceId: "i2", label: "INV-1048 · Petersen", detail: "Deposit or part payment in", amount: 12000, href: "/admin/invoices/i2#expected-final", jobHref: "/admin/jobs/j2", jobLabel: "Flat 4" },
    { id: "i3", invoiceId: "i3", label: "INV-1051 · Adams", detail: "Deposit or part payment in", amount: 8000, href: "/admin/invoices/i3#expected-final", jobHref: null, jobLabel: null },
  ],
  liabilityLines: [
    { id: "i1u", invoiceId: "i1", label: "INV-1042 · Ndlovu · 12 000 BTU", detail: "1 × R 18 400,00 incl. VAT · still to order · catalogue cost", amount: 18400, href: "/admin/invoices/i1#expected-final", jobHref: "/admin/jobs/j1", jobLabel: "House 12" },
    { id: "i2u", invoiceId: "i2", label: "INV-1048 · Petersen · 9 000 BTU", detail: "1 still to order · uncosted (no supplier price)", amount: 0, uncosted: true, href: "/admin/invoices/i2#expected-final", jobHref: "/admin/jobs/j2", jobLabel: "Flat 4" },
    { id: "i3u", invoiceId: "i3", label: "INV-1051 · Adams · 18 000 BTU", detail: "1 × R 3 600,00 incl. VAT · still to order · catalogue cost", amount: 3600, href: "/admin/invoices/i3#expected-final", jobHref: null, jobLabel: null },
  ],
  finalLines: [
    { id: "i1", invoiceId: "i1", label: "INV-1042 · Ndlovu", detail: "Expected 20 Nov 2026", amount: 22000, href: "/admin/invoices/i1#expected-final", jobHref: "/admin/jobs/j1", jobLabel: "House 12" },
    { id: "i2", invoiceId: "i2", label: "INV-1048 · Petersen", detail: "Expected 4 Dec 2026", amount: 9000, href: "/admin/invoices/i2#expected-final", jobHref: "/admin/jobs/j2", jobLabel: "Flat 4" },
    { id: "i3", invoiceId: "i3", label: "INV-1051 · Adams", detail: "Date not set", amount: 5000, href: "/admin/invoices/i3#expected-final", jobHref: null, jobLabel: null },
  ],
  when: [
    { key: "2026-11-20", label: "20 Nov 2026", total: 22000, lines: [] },
    { key: "2026-12-04", label: "4 Dec 2026", total: 9000, lines: [] },
    { key: "unset", label: "Date not set", total: 5000, lines: [] },
  ],
};
cash.when[0].lines = [cash.finalLines[0]];
cash.when[1].lines = [cash.finalLines[1]];
cash.when[2].lines = [cash.finalLines[2]];

const stock: StockGlance = {
  onHandNote: "On hand is the stock ledger: materials pool plus general units. Demo figures, not a live count.",
  gaps: [{ id: "g1", label: "House 9 · Adams", detail: "Piping kit 1/4 & 3/8: run length is not on this line, so pipe is not counted", href: "/admin/jobs/j3" }],
  candles: [
    { key: "s14", label: "Copper 1/4", unit: "m", onHand: 40, needed: 28, minimum: 15, stockItemId: "s14", href: "/admin/stock-count", small: true, gaps: [], jobs: [{ jobId: "j1", label: "House 12 · Ndlovu", href: "/admin/jobs/j1", qty: 10, note: "10 m from the pipe sizes on the line" }, { jobId: "j2", label: "Flat 4 · Petersen", href: "/admin/jobs/j2", qty: 18, note: null }], loss: { expected: 10, actual: 12, variance: 2, countGap: -4 } },
    { key: "s38", label: "Copper 3/8", unit: "m", onHand: 12, needed: 28, minimum: 15, stockItemId: "s38", href: "/admin/stock-count", small: true, gaps: [], jobs: [{ jobId: "j1", label: "House 12 · Ndlovu", href: "/admin/jobs/j1", qty: 10, note: null }, { jobId: "j2", label: "Flat 4 · Petersen", href: "/admin/jobs/j2", qty: 18, note: null }], loss: { expected: 10, actual: 11, variance: 1, countGap: null } },
    { key: "lag", label: "Lagging", unit: "m", onHand: 20, needed: 18, minimum: null, stockItemId: "lag", href: "/admin/stock-count", small: true, gaps: [], jobs: [{ jobId: "j1", label: "House 12 · Ndlovu", href: "/admin/jobs/j1", qty: 10, note: null }], loss: null },
    { key: "cab", label: "4-core + earth", unit: "m", onHand: 30, needed: 20, minimum: null, stockItemId: "cab", href: "/admin/stock-count", small: true, gaps: [], jobs: [{ jobId: "j1", label: "House 12 · Ndlovu", href: "/admin/jobs/j1", qty: 10, note: null }], loss: null },
    { key: "br", label: "Bracket", unit: "each", onHand: 6, needed: 4, minimum: 8, stockItemId: "br", href: "/admin/stock-count", small: true, gaps: [], jobs: [{ jobId: "j1", label: "House 12 · Ndlovu", href: "/admin/jobs/j1", qty: 4, note: "Active install allowance" }], loss: null },
  ],
};

const schedule: PaySchedule = {
  has_deposit: true, deposit_amount: 28000, deposit_date: "2026-11-01", deposit_date_auto: false, deposit_paid: 28000, deposit_outstanding: 0, deposit_status: "paid",
  final_amount: 22000, final_date: "2026-12-15", final_date_auto: false, final_after_days: 30, final_paid: 0, final_outstanding: 22000, final_status: "outstanding",
  terms_days: 0, can_edit: true,
};

const params = new URLSearchParams(location.search);
const sheet = params.get("sheet");
const part = params.get("part") || "all";
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

function Page() {
  const [mins, setMins] = useState(stock);
  return (
    <div className="mx-auto max-w-5xl space-y-4 bg-[#F4F7FB] p-3">
      <p data-testid="glance-demo-banner" className="rounded-xl border bg-white px-3 py-2 text-sm font-semibold text-[#5B6B7F]">Demo / harness — not live Massair CT totals</p>
      {part !== "invoice" && (
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="admin-home-glances">
        <CashFlowPieCard glance={cash} openFirst={sheet === "cash"} />
        <StockGlanceCard glance={mins} openFirst={sheet === "stock"} minimumsAvailable onSetMinimum={async (id, value) => {
          setMins((g) => ({ ...g, candles: g.candles.map((c) => c.stockItemId === id ? { ...c, minimum: value } : c) }));
          return null;
        }} />
      </div>
      )}
      {part !== "home" && <section id="invoice-demo" className="mx-auto max-w-xl space-y-2">
        <h2 className="text-sm font-bold text-[#0F1B2A]">Existing invoice · INV-1042 · Ndlovu</h2>
        <PaymentSchedulePanel invoiceId="demo-invoice" preview={schedule} />
      </section>}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <BrowserRouter><QueryClientProvider client={qc}><Page /></QueryClientProvider></BrowserRouter>,
);
