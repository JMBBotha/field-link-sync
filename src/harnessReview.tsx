// Screenshot harness, sample figures only. Not a live invoice and not a live payment.
import "./index.css";
import { createRoot } from "react-dom/client";
import { amountDueNow } from "@/lib/amountDueNow";
import { formatRand } from "@/utils/formatRand";
import { PAYMENT_DUPLICATE_MESSAGE, PAYMENT_OVERPAY_MESSAGE } from "@/lib/paymentGuard";
import ClientDepositActions from "@/components/client/ClientDepositActions";

const sample = amountDueNow({
  grandTotal: 28638.43,
  amountPaid: 0,
  depositAmount: 20046.9,
  depositType: "percent",
  status: "sent",
  today: "2026-11-11",
});

function InvoiceSample() {
  const money = (n: number) => formatRand(n);
  return (
    <section className="min-h-screen bg-[#F3F6FA] p-4" data-testid="harness-invoice">
      <p className="mb-3 rounded-lg bg-[#3D9BE8] px-3 py-2 text-sm font-semibold text-white">Demo harness, sample data. Not a live invoice.</p>
      <div className="mx-auto max-w-2xl space-y-3">
        <section className="rounded-2xl bg-white p-5 text-center shadow-sm" data-testid="client-amount-due">
          <p className="text-sm font-medium text-muted-foreground">Amount due now</p>
          <p className="mt-1 text-[40px] font-extrabold leading-tight tabular-nums text-ink" data-testid="client-due-figure">{money(sample.dueNow)}</p>
          <p className="mt-1 text-sm text-muted-foreground" data-testid="client-due-later">{money(sample.later)} is due later, on completion. Invoice total {money(28638.43)}.</p>
        </section>
        <section className="space-y-3 rounded-2xl bg-white p-5 shadow-sm" data-testid="client-pay">
          <h2 className="text-base font-bold text-ink">How to pay</h2>
          <div className="rounded-xl border bg-[#F8FAFC] p-3">
            <p className="mb-2 text-sm font-semibold text-ink">Bank details (EFT)</p>
            <p className="text-sm">Demo Bank · 000 000 000 · Reference INV-SAMPLE</p>
          </div>
          <p className="text-sm text-muted-foreground" data-testid="no-payfast">No card gateway on this page.</p>
        </section>
      </div>
    </section>
  );
}

function PaymentSample() {
  return (
    <section className="min-h-screen bg-[#F3F6FA] p-4" data-testid="harness-payment">
      <p className="mb-3 rounded-lg bg-[#3D9BE8] px-3 py-2 text-sm font-semibold text-white">Demo harness, sample payment checks.</p>
      <div className="mx-auto max-w-md space-y-3 rounded-2xl bg-white p-5 shadow-sm">
        <p className="text-sm font-bold">Record payment · INV-SAMPLE · outstanding R 8 591,53</p>
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800" data-testid="payment-guard" role="alert">{PAYMENT_OVERPAY_MESSAGE}</p>
        <p className="text-xs text-muted-foreground">Sample amount R 9 000,00 was not saved.</p>
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800" role="alert">{PAYMENT_DUPLICATE_MESSAGE}</p>
        <p className="text-xs text-muted-foreground">Sample reference POP-1 is already on the invoice.</p>
      </div>
    </section>
  );
}

function ProposalSample() {
  return (
    <section className="min-h-screen bg-[#F3F6FA] p-4" data-testid="harness-proposal">
      <p className="mb-3 rounded-lg bg-[#3D9BE8] px-3 py-2 text-sm font-semibold text-white">Demo harness, sample accepted quote. Pay by EFT.</p>
      <div className="mx-auto flex max-w-md flex-col items-center rounded-2xl border-t-4 border-t-emerald-500 bg-emerald-50 p-6">
        <h3 className="text-lg font-bold text-emerald-800">Quote accepted</h3>
        <div className="mt-3 w-full" data-testid="no-payfast">
          <ClientDepositActions
            invoice={{ id: "sample", invoice_number: "INV-SAMPLE", status: "sent", grand_total: 28638.43, deposit_amount: 20046.9, paid_date: null, notes: null }}
            payUrl="https://example.test/quote/sample"
            banking={{ bank_name: "Demo Bank", account_name: "Demo Air", account_number: "000111222", branch_code: "250655", account_type: "Cheque" }}
          />
        </div>
      </div>
    </section>
  );
}

function ShortageSample() {
  return (
    <section className="min-h-screen bg-[#F3F6FA] p-4" data-testid="harness-shortage">
      <p className="mb-3 rounded-lg bg-[#3D9BE8] px-3 py-2 text-sm font-semibold text-white">Demo harness, sample stock alert. No prices.</p>
      <article className="mx-auto max-w-md rounded-2xl border border-amber-300 bg-white p-5 shadow-sm" data-testid="shortage-alert">
        <p className="text-xs font-bold uppercase tracking-wide text-amber-800">In-app alert</p>
        <h2 className="mt-1 text-lg font-bold text-ink">Stock short</h2>
        <p className="mt-2 text-sm text-ink">Copper pipe is short by 12 on this job. The office has been told.</p>
        <p className="mt-2 text-xs text-muted-foreground">Needed 20 · on hand 8 · shortfall 12. The stock ledger still records the full use.</p>
      </article>
    </section>
  );
}

const view = new URLSearchParams(location.search).get("shot") || "invoice";
const screen = view === "payment" ? <PaymentSample /> : view === "proposal" ? <ProposalSample /> : view === "shortage" ? <ShortageSample /> : <InvoiceSample />;
createRoot(document.getElementById("root")!).render(screen);
