import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { readFileSync } from "fs";
import InvoiceSignOff from "@/components/invoicing/InvoiceSignOff";

describe("invoice sign-off block (Johan 2 Nov 21:10)", () => {
  it("Massair CT: designed company block, never 0800 232 665 or Ind CC", () => {
    const html = renderToString(<InvoiceSignOff profile={{ legal_name: "MASSAIR CT (PTY) LTD", vat_number: "4630313080", email: "info@0800becool.co.za", website: "www.0800becool.co.za" } as any} />);
    expect(html).toContain('data-testid="invoice-signoff"');
    expect(html).toContain("Massair CT (Pty) Ltd");
    expect(html).toContain("4630313080");
    expect(html).toContain("(021) 802-2889");
    expect(html).toContain("www.0800becool.co.za");
    expect(html).not.toMatch(/0800 232 665|Ind CC/i);
  });
  it("other companies use only their own record", () => {
    const html = renderToString(<InvoiceSignOff profile={{ legal_name: "Demo Client A (Pty) Ltd", phone: "021 000 0000", email: "a@demo.test" } as any} />);
    expect(html).toContain("Demo Client A (Pty) Ltd");
    expect(html).not.toMatch(/0800|Massair/i);
  });
  it("is rendered after the terms, invoices only", () => {
    const inv = readFileSync("src/components/invoicing/InvoiceDocument.tsx", "utf8");
    expect(inv.indexOf("<InvoiceSignOff")).toBeGreaterThan(inv.indexOf("<QuoteTermsPage"));
  });
});
