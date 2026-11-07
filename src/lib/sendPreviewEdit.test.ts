import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { finalInvoiceBodyHtml, FINAL_INVOICE_DEFAULT_MESSAGE, renderBrandedEmail, brandedTransactionalFooter } from "@/lib/brandedEmail";
import {
  bookingSendPayload, draftInvoiceHtmlForSend, draftInvoiceMessageFromHtml, finalInvoiceSendPayload,
  htmlToPlainMessage, plainMessageToEmailHtml, quoteSendFields,
} from "@/lib/sendPreviewEdit";
import L from "@/lib/brandedEmail.fixture.json";

const base = L.data as Parameters<typeof finalInvoiceBodyHtml>[0];

describe("final invoice wording is what gets sent", () => {
  it("keeps the approved sentence until the message is edited", () => {
    const html = finalInvoiceBodyHtml({ ...base, message: FINAL_INVOICE_DEFAULT_MESSAGE });
    expect(html).toContain(FINAL_INVOICE_DEFAULT_MESSAGE);
    expect(html).toContain("R 6 412,20");
    expect(html).toContain("View &amp; pay invoice");
  });
  it("puts the edited message in the email and escapes it, without touching the balance", () => {
    const html = finalInvoiceBodyHtml({ ...base, message: "Please pay by Friday.\n\nRef <script>alert(1)</script>" });
    expect(html).toContain("Please pay by Friday.");
    expect(html).toContain("&lt;script&gt;");
    const sameLine = finalInvoiceBodyHtml({ ...base, message: "Hi Sam, the work is finished. Please pay by Friday." });
    expect(sameLine).toContain("the work is finished");
    const greetingOnly = finalInvoiceBodyHtml({ ...base, message: "Hi Sam,\n\nPlease pay by Friday." });
    expect(greetingOnly).toContain("Please pay by Friday.");
    expect(greetingOnly).not.toContain("Hi Sam");
    expect(html).not.toContain(FINAL_INVOICE_DEFAULT_MESSAGE);
    expect(html).toContain("R 6 412,20");
    expect(html).toContain("INV-042");
  });
  it("send payload carries the trimmed subject and message", () => {
    expect(finalInvoiceSendPayload("inv-1", "a@b.co", "  Custom subject  ", "  Please pay Friday.  ")).toEqual({
      p_invoice: "inv-1", p_to: "a@b.co", p_mode: "send", p_subject: "Custom subject", p_message: "Please pay Friday.",
    });
  });
  it("the migration sends that subject and message, not a fresh template", () => {
    const sql = readFileSync("supabase/migrations/20261107160000_editable_send_previews.sql", "utf8");
    expect(sql).toContain("'message', v_message");
    expect(sql).toContain("nullif(btrim(p_subject), '')");
    expect(sql).toContain("p_html");
    expect(sql).toContain("app.invoice_skip_email");
    const branded = renderBrandedEmail({
      brand: L.brand as never, title: "Custom subject", kicker: L.kicker, greetingName: L.greeting_name,
      bodyHtml: finalInvoiceBodyHtml({ ...base, message: "Please pay by Friday." }),
      footerHtml: brandedTransactionalFooter(L.brand.name),
    });
    expect(branded).toContain("Please pay by Friday.");
    expect(branded).toContain("Custom subject");
  });
});

describe("other previews pass the edit through", () => {
  it("booking sends the edited subject and body, and leaves an untouched preview on the template", () => {
    const original = { subject: "Your technician visit is booked – Thursday", body: "Hi Sam,\n\nYour visit is booked." };
    expect(bookingSendPayload("job-1", "a@b.co", original.subject, original.body, original)).toMatchObject({ p_subject: null, p_body: null });
    expect(bookingSendPayload("job-1", "a@b.co", "See you Thursday", "Hi Sam,\n\nWe moved it to 11:00.", original)).toMatchObject({
      p_subject: "See you Thursday", p_body: "Hi Sam,\n\nWe moved it to 11:00.", p_mode: "send",
    });
  });
  it("plain booking text round-trips and escapes", () => {
    const html = `<html><body><p>Hi Sam,</p><p>Your visit is booked for <b>Thursday</b>.</p><p style="background:#FFF4E5"><b>Call-out fee:</b> R680 excl. VAT</p></body></html>`;
    const text = htmlToPlainMessage(html);
    expect(text).toContain("Hi Sam,");
    expect(text).toContain("Call-out fee: R680 excl. VAT");
    expect(plainMessageToEmailHtml("Hi <Sam>")).toContain("Hi &lt;Sam&gt;");
    expect(plainMessageToEmailHtml("Hi <Sam>")).not.toContain("<Sam>");
  });
  it("quote send uses the edited subject and keeps an empty message optional", () => {
    expect(quoteSendFields("  Your quote Q-9  ", "  Thanks for waiting.  ")).toEqual({ subject: "Your quote Q-9", message: "Thanks for waiting." });
    expect(quoteSendFields("Your quote Q-9", "   ")).toEqual({ subject: "Your quote Q-9", message: undefined });
    const src = readFileSync("src/components/quoting/SendQuoteDialog.tsx", "utf8");
    const send = src.slice(src.indexOf("const res = await supabase.functions.invoke"));
    expect(send).toContain("subject: fields.subject");
    expect(send).toContain("message: fields.message");
    expect(send).not.toContain("Your quote ${quoteNumber}");
  });
  it("draft invoice edit replaces the note and keeps the total", () => {
    const html = `<p>Invoice <strong>INV-042</strong></p><p>Dear <strong>Sam</strong>,</p><p style="margin:0 0 20px;">Thank you for accepting quote Q-1. Please find the invoice for <strong>R 1 000,00</strong> below.</p><p>Amount due R 1 000,00</p>`;
    expect(draftInvoiceMessageFromHtml(html)).toContain("Thank you for accepting quote Q-1");
    const next = draftInvoiceHtmlForSend(html, "Please ignore the old note.\n\nPay the balance.", draftInvoiceMessageFromHtml(html));
    expect(next).toContain("Please ignore the old note.");
    expect(next).toContain("Pay the balance.");
    expect(next).not.toContain("Thank you for accepting");
    expect(next).toContain("INV-042");
    expect(next).toContain("R 1 000,00");
    expect(draftInvoiceHtmlForSend(html, draftInvoiceMessageFromHtml(html), draftInvoiceMessageFromHtml(html))).toBe(html);
  });
  it("payment reminders already send the edited subject and message", () => {
    const src = readFileSync("src/components/invoicing/PaymentReminderDialog.tsx", "utf8");
    expect(src).toContain("p_subject: subject");
    expect(src).toContain("p_message: msg");
    expect(src).toContain("p_html: html");
  });
});
