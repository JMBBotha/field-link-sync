import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { readFileSync } from "fs";
import InvoiceSignOff from "@/components/invoicing/InvoiceSignOff";

describe("invoice sign-off block (Johan 2 Nov 21:10)", () => {
  it("Massair CT: designed company block, never 0800 232 665 or Ind CC", () => {
    const html = renderToString(<InvoiceSignOff profile={{ legal_name: "MASSAIR CT (PTY) LTD", vat_number: "4630313080", email: "info@0800becool.co.za", website: "www.0800becool.co.za", phone: "(021) 802-2889" } as any} />);
    expect(html).toContain('data-testid="invoice-signoff"');
    expect(html).toContain("MASSAIR CT (PTY) LTD");
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
  it("is company-specific: record fields only, empty fields hidden, record logo used", () => {
    const html = renderToString(<InvoiceSignOff profile={{ legal_name: "Demo Client B (Pty) Ltd", trading_name: "Demo B Cooling", vat_number: "4999999999", phone: "011 111 1111", whatsapp: "082 222 2222", email: "b@demo.test", website: "www.demo-b.test", address_lines: ["1 Demo Rd", "Demo Town"], logo_url: "https://demo.test/logo.png" } as any} />);
    for (const v of ["Demo B Cooling", "Demo Client B (Pty) Ltd", "4999999999", "011 111 1111", "082 222 2222", "b@demo.test", "www.demo-b.test", "1 Demo Rd, Demo Town", "https://demo.test/logo.png"]) expect(html).toContain(v);
    const bare = renderToString(<InvoiceSignOff profile={{ legal_name: "Demo Client C" } as any} />);
    expect(bare).not.toMatch(/Tel:|WhatsApp|VAT No|<img/);
  });
  it("is rendered after the terms, invoices only", () => {
    const inv = readFileSync("src/components/invoicing/InvoiceDocument.tsx", "utf8");
    expect(inv.indexOf("<InvoiceSignOff")).toBeGreaterThan(inv.indexOf("<QuoteTermsPage"));
  });
});
