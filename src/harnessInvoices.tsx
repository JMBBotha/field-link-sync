// Screenshot harness. Sample invoices only. Nothing is emailed and no client record is read.
import "./index.css";
import "./components/v8/v8.css";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import InvoiceEmailBar from "@/components/invoicing/InvoiceEmailBar";
import BulkInvoiceEmailDialog from "@/components/invoicing/BulkInvoiceEmailDialog";
import { bulkInvoiceEmailGate, type BulkInvoiceRow } from "@/lib/bulkInvoiceEmail";

const rows: BulkInvoiceRow[] = [
  { id: "1", invoice_number: "INV-1041", customer_id: "demo", customer_name: "Demo Client", customer_email: "client@example.com", status: "sent", grand_total: 12400, amount_due: 12400 },
  { id: "2", invoice_number: "INV-1048", customer_id: "demo", customer_name: "Demo Client", customer_email: "client@example.com", status: "sent", grand_total: 8250, amount_due: 2100 },
  { id: "3", invoice_number: "INV-1052", customer_id: "demo", customer_name: "Demo Client", customer_email: "client@example.com", status: "draft", grand_total: 0, amount_due: 0 },
  { id: "4", invoice_number: "INV-1060", customer_id: "demo", customer_name: "Demo Client", customer_email: "client@example.com", status: "void", grand_total: 900, amount_due: 0 },
];

const money = (n: number) => `R ${n.toLocaleString("en-ZA").replace(/,/g, " ")}`;

function InvoicesHarness() {
  const params = new URLSearchParams(window.location.search);
  const [open, setOpen] = useState(params.get("dialog") === "1");
  const gate = bulkInvoiceEmailGate(rows);
  return (
    <main className="v8-scope min-h-screen bg-background p-3 sm:p-6" data-testid="invoices-email-harness">
      <p className="mb-3 rounded-lg bg-[#3D9BE8] px-3 py-2 text-sm font-semibold text-white">
        Demo harness, sample invoices. Nothing is emailed and no client data is used.
      </p>
      <div className="v8-navy mb-4 px-4 py-4">
        <h1 className="text-2xl font-bold tracking-tight">Invoices</h1>
        <p className="mt-1 text-sm">4 invoices · sample</p>
      </div>
      <InvoiceEmailBar
        selectedCount={rows.length}
        emailCount={gate.included.length}
        emailEnabled={gate.ok}
        emailReason={gate.reason}
        contractEnabled
        onCancel={() => undefined}
        onContract={() => undefined}
        onEmail={() => setOpen(true)}
      />
      <div className="mt-4 space-y-2">
        {rows.map((row) => (
          <div key={row.id} className="flex min-h-[56px] items-center gap-2 rounded-xl border border-border/60 bg-card px-2 py-2.5 shadow-sm">
            <span className="flex h-11 w-11 items-center justify-center">
              <Checkbox checked aria-label={`Select ${row.invoice_number}`} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-semibold">{row.customer_name}</div>
              <div className="mt-0.5 truncate text-sm text-muted-foreground">{row.status} · {row.invoice_number}</div>
            </div>
            <div className="text-sm font-semibold">{money(Number(row.amount_due) || 0)}</div>
          </div>
        ))}
      </div>
      <BulkInvoiceEmailDialog
        open={open}
        onOpenChange={setOpen}
        rows={gate.included}
        companyName="Massair CT"
        excludedNote={gate.excluded.map((item) => item.reason).join(" ")}
        localOnly
        buildAttachment={async () => ({ filename: "Invoices-Demo-Client.pdf", content: "JVBERi0=" })}
      />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<InvoicesHarness />);
