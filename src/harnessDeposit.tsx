// Screenshot harness. Sample figures only. Not a live invoice and not a payment.
import "./index.css";
import "./components/v8/v8.css";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import InvoiceDocument from "@/components/invoicing/InvoiceDocument";
import DepositDueBlock from "@/components/invoicing/DepositDueBlock";
import { invoiceDepositCallout } from "@/lib/invoiceDepositCallout";
import { formatRand } from "@/utils/formatRand";

const params = new URLSearchParams(location.search);
const shot = params.get("shot") || "app-unpaid";
const theme = params.get("theme") === "dark" ? "dark" : "light";
document.documentElement.classList.remove("light", "dark");
document.documentElement.classList.add(theme);
document.documentElement.style.colorScheme = theme;

type Kind = "unpaid" | "paid" | "none";
const kind: Kind = shot.endsWith("paid") && !shot.includes("unpaid") ? "paid" : shot.endsWith("none") ? "none" : "unpaid";
const surface = shot.startsWith("pdf") ? "pdf" : shot.startsWith("public") ? "public" : "app";

const profile = {
  legal_name: "MASSAIR CT (PTY) LTD",
  trading_name: "0800-BE-COOL",
  vat_number: "4630313080",
  phone: "(021) 802-2889",
  email: "info@0800becool.co.za",
  website: "www.0800becool.co.za",
  address_lines: ["Unit 4, Demo Park", "Cape Town"],
  bank_name: "FNB",
  account_name: "MASSAIR CT (PTY) LTD",
  account_number: "63226563591",
  branch_code: "250655",
  account_type: "Cheque",
  document_style: "light",
};

const stored = {
  grandTotal: 28638.43,
  depositAmount: 20046.9,
  depositType: "percent" as const,
  depositValue: 70,
  notes: "Quote Q-100: total R 28638.43 incl VAT. 70% deposit R 20046.90 due now; balance R 8591.53 on completion.",
};

function SampleInvoice() {
  return (
    <InvoiceDocument
      invoiceNumber="INV-100"
      status={kind === "paid" ? "partially_paid" : "sent"}
      issueDate="2026-11-11"
      dueDate="2026-12-11"
      customerName="AVEC La Terre"
      customerAddress="12 Estate Road, Cape Town"
      customerEmail="accounts@avec.example"
      items={[{ description: "Lounge · 18000 BTU split, supply and install", quantity: 1, unit_price: 24902.98, amount: 24902.98, line_name: "Lounge split" }]}
      subtotal={24902.98}
      taxRate={15}
      taxAmount={3735.45}
      grandTotal={stored.grandTotal}
      amountPaid={kind === "paid" ? stored.depositAmount : 0}
      notes={kind === "none" ? "All workmanship carries a 12-month warranty." : stored.notes}
      profile={profile}
      depositAmount={kind === "none" ? null : stored.depositAmount}
      depositType={kind === "none" ? null : stored.depositType}
      depositValue={kind === "none" ? null : stored.depositValue}
      termsCompany={{
        companyName: "MASSAIR CT (PTY) LTD",
        bankName: "FNB",
        accountName: "MASSAIR CT (PTY) LTD",
        accountNumber: "63226563591",
        branchCode: "250655",
        accountType: "Cheque",
      }}
    />
  );
}

function PublicSample() {
  const callout = kind === "none" ? null : invoiceDepositCallout({ ...stored, amountPaid: kind === "paid" ? stored.depositAmount : 0, status: "sent" });
  const due = kind === "paid" ? 0 : kind === "none" ? stored.grandTotal : stored.depositAmount;
  return (
    <div className="min-h-screen bg-[#F3F6FA] p-4" data-testid="harness-public">
      <header className="mb-3 rounded-xl bg-[#1B3A5C] px-4 py-3 text-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <span className="font-semibold">MASSAIR CT (PTY) LTD</span>
          <span className="text-sm opacity-90">INV-100</span>
        </div>
      </header>
      <section className="mx-auto max-w-2xl rounded-2xl bg-white p-5 text-center shadow-sm" data-testid="client-amount-due">
        {callout && <div className="mb-4 text-left"><DepositDueBlock model={callout} /></div>}
        <p className="text-sm font-medium" style={{ color: "#3a4859" }}>{kind === "none" ? "Amount due" : "Amount due now"}</p>
        <p className="mt-1 text-[40px] font-extrabold leading-tight tabular-nums" style={{ color: "#1d2a3a" }}>{formatRand(due)}</p>
        {kind !== "none" && <p className="mt-1 text-sm" style={{ color: "#3a4859" }}>{formatRand(8591.53)} is due later, on completion. Invoice total {formatRand(stored.grandTotal)}.</p>}
      </section>
      <section className="mx-auto mt-3 max-w-2xl rounded-2xl bg-white p-5 shadow-sm" data-testid="client-pay">
        <h2 className="text-base font-bold" style={{ color: "#1d2a3a" }}>How to pay</h2>
        <p className="mt-2 text-sm" style={{ color: "#3a4859" }}>Bank details (EFT) · FNB · 63226563591 · Reference INV-100</p>
        <p className="mt-2 text-sm" style={{ color: "#3a4859" }} data-testid="no-payfast">Pay by EFT. No PayFast on this page.</p>
      </section>
    </div>
  );
}

function PdfSample() {
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let gone = false;
    const timer = window.setTimeout(async () => {
      try {
        const { generateDocumentPdfBlob } = await import("@/lib/documentPdf");
        const blob = await generateDocumentPdfBlob({
          docType: "Invoice",
          docNumber: "INV-100",
          companyName: "MASSAIR CT (PTY) LTD",
          customerName: "AVEC La Terre",
          issueDate: "2026-11-11",
          dueDate: "2026-12-11",
          lineItems: [{ description: "Lounge split", quantity: 1, rate: 24902.98, amount: 24902.98 }],
          subtotal: 24902.98,
          taxRate: 15,
          taxAmount: 3735.45,
          total: stored.grandTotal,
          notes: stored.notes,
          captureSelector: '[data-pdf-capture-root="invoice"]',
          termsCompany: { companyName: "MASSAIR CT (PTY) LTD", bankName: "FNB", accountNumber: "63226563591" },
        });
        if (gone) return;
        const lib = await import("pdfjs-dist");
        const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default as string;
        lib.GlobalWorkerOptions.workerSrc = worker;
        const pdf = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 1.4 });
        const canvas = document.getElementById("deposit-pdf-page") as HTMLCanvasElement | null;
        if (!canvas) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
        if (!gone) setReady(true);
      } catch (e) {
        if (!gone) setError(e instanceof Error ? e.message : "PDF failed");
      }
    }, 500);
    return () => { gone = true; window.clearTimeout(timer); };
  }, []);
  return (
    <div data-testid="harness-pdf" className="bg-[#d5dde6] p-4">
      <div style={{ position: "absolute", left: -12000, top: 0, width: 820 }} aria-hidden>
        <SampleInvoice />
      </div>
      <p className="mb-3 rounded-lg bg-[#3D9BE8] px-3 py-2 text-sm font-semibold text-white">Demo harness. First page of the generated invoice PDF. Sample data, not a live invoice. {error ? `Could not build the PDF: ${error}` : ready ? "PDF ready." : "Building the PDF from the invoice…"}</p>
      <canvas id="deposit-pdf-page" data-testid="deposit-pdf-page" data-ready={ready ? "true" : "false"} style={{ background: "#fff", maxWidth: "100%" }} />
    </div>
  );
}

function AppSample() {
  return (
    <div className="min-h-screen bg-[#e8eef5] p-4" data-testid="harness-app">
      <p className="mb-3 rounded-lg bg-[#3D9BE8] px-3 py-2 text-sm font-semibold text-white">Demo harness, sample invoice. Not a live invoice. {theme === "dark" ? "Dark mode." : "Light mode."}</p>
      <SampleInvoice />
    </div>
  );
}

const screen = surface === "pdf" ? <PdfSample /> : surface === "public" ? <PublicSample /> : <AppSample />;
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {screen}
  </QueryClientProvider>,
);
