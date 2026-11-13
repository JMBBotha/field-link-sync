import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PDFDocument } from "pdf-lib";
import InvoiceEmailBar from "@/components/invoicing/InvoiceEmailBar";
import BulkInvoiceEmailDialog, { type BulkEmailRequest } from "@/components/invoicing/BulkInvoiceEmailDialog";
import {
  bulkInvoiceEmailGate,
  bulkInvoiceBodyHtml,
  bulkInvoiceSubject,
  combinedInvoicePdfName,
  type BulkInvoiceRow,
} from "@/lib/bulkInvoiceEmail";
import { mergePdfBlobs } from "@/lib/bulkQuotePdf";
import { transactionalFrom, mergeEmailAttachments } from "../../supabase/functions/_shared/transactionalSend";

const client = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function row(partial: Partial<BulkInvoiceRow> & Pick<BulkInvoiceRow, "id" | "invoice_number">): BulkInvoiceRow {
  return {
    customer_id: client,
    customer_name: "Demo Client",
    customer_email: "client@example.com",
    status: "sent",
    grand_total: 1000,
    amount_due: 400,
    ...partial,
  };
}

describe("same-client gating", () => {
  it("allows two invoices for one client and refuses a second client", () => {
    const same = bulkInvoiceEmailGate([
      row({ id: "1", invoice_number: "INV-1" }),
      row({ id: "2", invoice_number: "INV-2" }),
    ]);
    expect(same.ok).toBe(true);
    expect(same.customerId).toBe(client);
    expect(same.included).toHaveLength(2);

    const mixed = bulkInvoiceEmailGate([
      row({ id: "1", invoice_number: "INV-1" }),
      row({ id: "2", invoice_number: "INV-2", customer_id: other }),
    ]);
    expect(mixed.ok).toBe(false);
    expect(mixed.reason).toMatch(/same client/);
  });

  it("leaves void and draft-with-R0 invoices out, with a clear message", () => {
    const gate = bulkInvoiceEmailGate([
      row({ id: "1", invoice_number: "INV-1" }),
      row({ id: "2", invoice_number: "INV-2" }),
      row({ id: "3", invoice_number: "INV-3", status: "void" }),
      row({ id: "4", invoice_number: "INV-4", status: "draft", grand_total: 0 }),
      row({ id: "5", invoice_number: "INV-5", status: "draft", grand_total: 500, lines: [{ description: "Filter", unit_price: 0, quantity: 1 }] }),
    ]);
    expect(gate.ok).toBe(true);
    expect(gate.included.map((r) => r.invoice_number)).toEqual(["INV-1", "INV-2"]);
    expect(gate.reason).toMatch(/INV-3 is void/);
    expect(gate.reason).toMatch(/INV-4 is a draft with R0/);
    expect(gate.reason).toMatch(/INV-5 is a draft with R0/);
  });

  it("needs at least two invoices that can be sent", () => {
    const one = bulkInvoiceEmailGate([row({ id: "1", invoice_number: "INV-1" })]);
    expect(one.ok).toBe(false);
    expect(one.reason).toMatch(/at least two/);
  });

  it("the tick bar keeps the service-contract action and only enables email for one client", () => {
    const { rerender } = render(
      <InvoiceEmailBar
        selectedCount={2}
        sameClientReason="All selected invoices must be for the same client."
        emailCount={2}
        emailEnabled={false}
        contractEnabled={false}
        onCancel={() => undefined}
        onContract={() => undefined}
        onEmail={() => undefined}
      />,
    );
    expect(screen.getByTestId("invoice-create-contract")).toBeDisabled();
    expect(screen.getByTestId("invoice-email-these")).toBeDisabled();
    expect(screen.getByTestId("same-client-warning")).toHaveTextContent(/same client/);

    rerender(
      <InvoiceEmailBar
        selectedCount={2}
        emailCount={2}
        emailEnabled
        emailReason={null}
        contractEnabled
        onCancel={() => undefined}
        onContract={() => undefined}
        onEmail={() => undefined}
      />,
    );
    expect(screen.getByTestId("invoice-create-contract")).toBeEnabled();
    expect(screen.getByTestId("invoice-email-these")).toBeEnabled();
    expect(screen.getByTestId("invoice-email-these")).toHaveTextContent("Email these (2)");
  });
});

describe("one email for several invoices", () => {
  const rows = [
    row({ id: "1", invoice_number: "INV-1", grand_total: 1500, amount_due: 1500 }),
    row({ id: "2", invoice_number: "INV-2", grand_total: 800, amount_due: 200 }),
  ];

  it("builds one subject, lists each invoice, and does not mention PayFast", () => {
    expect(bulkInvoiceSubject(["INV-1", "INV-2"], "Massair CT")).toBe("Invoices INV-1, INV-2 from Massair CT");
    const html = bulkInvoiceBodyHtml([
      { invoice_number: "INV-1", amount: 1500, amount_due: 1500, link: "https://field-link-sync.lovable.app/customer/tok/invoice/1" },
      { invoice_number: "INV-2", amount: 800, amount_due: 200, link: "https://field-link-sync.lovable.app/customer/tok/invoice/2" },
    ], "Massair CT");
    expect(html).toContain("INV-1");
    expect(html).toContain("INV-2");
    expect(html).toContain("Amount due");
    expect(html).toContain("/invoice/1");
    expect(html).toContain("/invoice/2");
    expect(html.toLowerCase()).not.toContain("payfast");
    expect(combinedInvoicePdfName("Demo Client", new Date("2026-11-13T08:00:00Z"))).toBe("Invoices-Demo Client-2026-11-13.pdf");
  });

  it("sends once, with one combined PDF, and does not call the mailer per invoice", async () => {
    const calls: BulkEmailRequest[] = [];
    const sender = vi.fn(async (input: BulkEmailRequest) => {
      calls.push(input);
      if (input.mode === "preview") {
        return {
          ok: true,
          to: "client@example.com",
          subject: "Invoices INV-1, INV-2 from Massair CT",
          html: "<p>INV-1</p><p>INV-2</p><p>Amount due</p>",
          from_name: "Massair CT (Pty) Ltd",
          from_email: "johan@0800becool.co.za",
        };
      }
      return { ok: true, to: input.to, sent_at: "2026-11-13T10:00:00Z", email_count: 1, invoices: [{ invoice_number: "INV-1" }, { invoice_number: "INV-2" }] };
    });
    const buildAttachment = vi.fn(async (ids: string[]) => {
      expect(ids).toEqual(["1", "2"]);
      const doc = await PDFDocument.create();
      doc.addPage();
      const blob = new Blob([new Uint8Array(await doc.save())], { type: "application/pdf" });
      const merged = await mergePdfBlobs([blob, blob]);
      expect(merged.type).toBe("application/pdf");
      return { filename: "Invoices-Demo Client-2026-11-13.pdf", content: "JVBERi0=" };
    });
    render(
      <BulkInvoiceEmailDialog open rows={rows} companyName="Massair CT" sender={sender} buildAttachment={buildAttachment} onOpenChange={() => undefined} />,
    );
    await waitFor(() => expect(screen.getByTestId("bulk-email-from")).toHaveTextContent("johan@0800becool.co.za"));
    expect(screen.getByTestId("bulk-email-subject")).toHaveTextContent("Invoices INV-1, INV-2 from Massair CT");
    fireEvent.click(screen.getByTestId("bulk-email-send"));
    await waitFor(() => expect(screen.getByTestId("bulk-emailed")).toHaveTextContent(/INV-1/));
    const sends = calls.filter((call) => call.mode === "send");
    expect(sends).toHaveLength(1);
    expect(sends[0].ids).toEqual(["1", "2"]);
    expect(sends[0].attachment?.filename).toMatch(/\.pdf$/);
    expect(buildAttachment).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("bulk-emailed").textContent || "").not.toMatch(/payfast/i);
  });

  it("uses the company sender on the verified domain and attaches one PDF", () => {
    expect(transactionalFrom({ fromEmail: "johan@0800becool.co.za", fromName: "Massair CT (Pty) Ltd" }))
      .toBe("Massair CT (Pty) Ltd <johan@0800becool.co.za>");
    expect(transactionalFrom({ fromEmail: "someone@gmail.com", fromName: "Other", envFrom: "0800-BE-COOL <wcquotes@0800becool.co.za>" }))
      .toBe("0800-BE-COOL <wcquotes@0800becool.co.za>");
    const files = mergeEmailAttachments([], [
      { filename: "Invoices-Demo.pdf", content: "QQ==" },
      { filename: "notes.txt", content: "nope" },
    ]);
    expect(files).toEqual([{ filename: "Invoices-Demo.pdf", content: "QQ==" }]);
  });

  it("the list keeps both actions and the mail function posts one attachment", () => {
    const page = readFileSync("src/components/invoicing/InvoiceListPage.tsx", "utf8");
    const fn = readFileSync("supabase/functions/send-transactional-email/index.ts", "utf8");
    const sql = readFileSync("supabase/migrations/20261113165000_send_invoices_email.sql", "utf8");
    const bar = readFileSync("src/components/invoicing/InvoiceEmailBar.tsx", "utf8");
    expect(page).toContain("<InvoiceEmailBar");
    expect(page).toContain("bulkInvoiceEmailGate");
    expect(bar).toContain("Email these (");
    expect(bar).toContain("Create service contract");
    expect(page).toContain("mergePdfBlobs");
    expect(page.toLowerCase()).not.toContain("payfast");
    expect(fn).toContain("mergeEmailAttachments");
    expect(fn).toContain("transactionalFrom");
    expect(sql.match(/net\.http_post/g)).toHaveLength(1);
    expect(sql).toContain("app.invoice_skip_email");
    expect(sql).toContain("invoice_email_queued");
    expect(sql).not.toMatch(/grand_total\s*=/);
    expect(sql).not.toMatch(/invoice_number\s*=/);
    expect(sql.toLowerCase()).not.toContain("payfast");
  });
});
