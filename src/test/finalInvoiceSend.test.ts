import { describe, it, expect } from "vitest";
import { finalSentLabel, finalInvoiceWhatsAppUrl } from "@/lib/invoiceMoney";
import { filterInvoices } from "@/lib/drilldown";

describe("final invoice send", () => {
  it("label shows SAST time and channel", () => {
    expect(finalSentLabel({ final_sent_at: null })).toBeNull();
    const l = finalSentLabel({ final_sent_at: "2026-10-30T17:52:00Z", final_sent_channel: "whatsapp" })!;
    expect(l).toMatch(/^Final invoice sent 30 Oct/);
    expect(l).toContain("19:52");
    expect(l).toMatch(/via WhatsApp$/);
  });
  it("WhatsApp link uses the balance and a 27 number", () => {
    const u = finalInvoiceWhatsAppUrl({ invoice_number: "INV-042", customer_name: "Marina", customer_phone: "082 600 5644" }, 6412.2)!;
    expect(u.startsWith("https://wa.me/27826005644?text=")).toBe(true);
    expect(decodeURIComponent(u)).toMatch(/Balance due: R 6.412,20|Balance due: R 6 412,20|Balance due: R 6,412.20/);
    expect(finalInvoiceWhatsAppUrl({ customer_phone: "" }, 1)).toBeNull();
  });
  it("part-paid counts as Unpaid and Sent", () => {
    const rows = [{ status: "partially_paid" }, { status: "sent" }, { status: "paid" }] as any[];
    expect(filterInvoices(rows, { state: "unpaid" })).toHaveLength(2);
    expect(filterInvoices(rows, { state: "sent" })).toHaveLength(2);
    expect(filterInvoices(rows, { state: "paid" })).toHaveLength(1);
  });
});
