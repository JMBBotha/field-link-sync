import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FINAL_INVOICE_DEFAULT_MESSAGE } from "@/lib/brandedEmail";
import L from "@/lib/brandedEmail.fixture.json";

const calls: unknown[][] = [];
let impl: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> = async () => ({ data: null, error: null });
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (name: string, args: Record<string, unknown>) => { calls.push([name, args]); return impl(name, args); },
    functions: { invoke: async () => ({ data: null, error: null }) },
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  },
}));
vi.mock("@/lib/invoicePriced", () => ({ invoiceMissingPrices: async () => null }));

import FinalInvoiceSendDialog from "@/components/invoicing/FinalInvoiceSendDialog";
import BookingConfirmationEmail from "@/components/jobs/BookingConfirmationEmail";
import SendInvoiceEmailButton from "@/components/invoicing/SendInvoiceEmailButton";
import SendQuoteDialog from "@/components/quoting/SendQuoteDialog";

const layout = {
  template: "final_invoice",
  brand: L.brand,
  title: L.title,
  kicker: L.kicker,
  greeting_name: L.greeting_name,
  data: L.data,
};

describe("send preview editors pass the edited text", () => {
  beforeEach(() => { calls.length = 0; });

  it("final invoice send uses the edited subject and message", async () => {
    impl = async (_name, args) => {
      if (args.p_mode === "preview") {
        return { data: { to: "sam@example.com", subject: "Final invoice INV-042 - balance R 6 412,20", message: FINAL_INVOICE_DEFAULT_MESSAGE, html: "<p>old</p>", layout }, error: null };
      }
      return { data: { to: args.p_to, final_sent_at: "2026-11-07T10:00:00Z", subject: args.p_subject }, error: null };
    };
    render(<FinalInvoiceSendDialog invoice={{ id: "inv-1", invoice_number: "INV-042", customer_name: "Sam Testclient", customer_email: "sam@example.com" }} balance={6412.2} />);
    fireEvent.click(screen.getByTestId("send-final-invoice"));
    fireEvent.click(screen.getByTestId("final-email-preview"));
    const subject = await screen.findByTestId("final-email-subject");
    const body = screen.getByTestId("final-email-body");
    expect(subject).toHaveValue("Final invoice INV-042 - balance R 6 412,20");
    expect(body).toHaveValue(FINAL_INVOICE_DEFAULT_MESSAGE);
    expect(subject).not.toHaveAttribute("readonly");
    fireEvent.change(subject, { target: { value: "Balance for the beach house" } });
    fireEvent.change(body, { target: { value: "Please pay by Friday, the unit is in." } });
    fireEvent.click(screen.getByTestId("final-email-send"));
    await waitFor(() => expect(calls.some((c) => (c[1] as { p_mode?: string }).p_mode === "send")).toBe(true));
    const send = calls.find((c) => (c[1] as { p_mode?: string }).p_mode === "send")![1] as Record<string, string>;
    expect(send.p_subject).toBe("Balance for the beach house");
    expect(send.p_message).toBe("Please pay by Friday, the unit is in.");
    expect(send.p_message).not.toBe(FINAL_INVOICE_DEFAULT_MESSAGE);
    expect(send.p_to).toBe("sam@example.com");
  });

  it("booking confirmation send uses the edited subject and message", async () => {
    const html = "<html><body><p>Hi Sam,</p><p>Your technician visit is booked for <b>Thursday</b>.</p><p>Reply to this email if you need to change it.</p></body></html>";
    impl = async (_name, args) => {
      if (args.p_mode === "preview") return { data: { ok: true, to: "sam@example.com", subject: "Your technician visit is booked – Thursday", html, call_out: false }, error: null };
      return { data: { ok: true, to: args.p_to, subject: args.p_subject }, error: null };
    };
    render(<BookingConfirmationEmail jobId="job-1" />);
    fireEvent.click(screen.getByTestId("booking-email-open"));
    const subject = await screen.findByTestId("booking-email-subject");
    fireEvent.change(subject, { target: { value: "Visit moved to 11:00" } });
    fireEvent.change(screen.getByTestId("booking-email-body"), { target: { value: "Hi Sam,\n\nWe moved the visit to 11:00." } });
    fireEvent.click(screen.getByTestId("booking-email-send"));
    await waitFor(() => expect(calls.some((c) => c[0] === "send_booking_confirmation" && (c[1] as { p_mode?: string }).p_mode === "send")).toBe(true));
    const send = calls.find((c) => (c[1] as { p_mode?: string }).p_mode === "send")![1] as Record<string, string>;
    expect(send.p_subject).toBe("Visit moved to 11:00");
    expect(send.p_body).toBe("Hi Sam,\n\nWe moved the visit to 11:00.");
  });

  it("draft invoice send uses the edited subject and the edited note", async () => {
    const html = `<h1>Invoice INV-042</h1><p>Dear <strong>Sam</strong>,</p><p>Thank you for accepting quote Q-1. Please find the invoice for <strong>R 1 000,00</strong>.</p><p>Total R 1 000,00</p>`;
    impl = async (name) => {
      if (name === "invoice_email_preview") return { data: { to: "sam@example.com", accounts_copy: null, subject: "Invoice INV-042 from Massair CT — R 1 000,00 due", html }, error: null };
      return { data: { ok: true, to: "sam@example.com", subject: "edited" }, error: null };
    };
    render(<SendInvoiceEmailButton invoiceId="inv-1" status="draft" />);
    fireEvent.click(screen.getByRole("button", { name: /Preview & email/i }));
    const subject = await screen.findByTestId("draft-invoice-subject");
    fireEvent.change(subject, { target: { value: "Invoice for the lounge unit" } });
    fireEvent.change(screen.getByTestId("draft-invoice-body"), { target: { value: "The lounge unit is installed. Please pay this week." } });
    fireEvent.click(screen.getByRole("button", { name: /^Send$/ }));
    await waitFor(() => expect(calls.some((c) => c[0] === "send_reviewed_invoice_email")).toBe(true));
    const send = calls.find((c) => c[0] === "send_reviewed_invoice_email")![1] as { p_subject: string; p_html: string };
    expect(send.p_subject).toBe("Invoice for the lounge unit");
    expect(send.p_html).toContain("The lounge unit is installed.");
    expect(send.p_html).toContain("INV-042");
    expect(send.p_html).not.toContain("Thank you for accepting");
  });

  it("quote preview send uses the edited subject and message", async () => {
    const onSend = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <SendQuoteDialog
          open
          onOpenChange={() => {}}
          quoteId=""
          quoteNumber="Q-2026-0042"
          customerId={null}
          customerName="Sam Testclient"
          previewFixture={{
            to: "sam@example.com",
            subject: "Your quote Q-2026-0042",
            message: "Thank you for the opportunity.",
            html: "<p>Thank you for the opportunity.</p><p>Total R 21 374,00</p>",
            onSend,
          }}
        />
      </QueryClientProvider>,
    );
    const subject = await screen.findByTestId("send-quote-subject");
    expect(subject).not.toHaveAttribute("readonly");
    fireEvent.change(subject, { target: { value: "Quote for the beach house" } });
    fireEvent.change(screen.getByLabelText("Message to client"), { target: { value: "Two options inside, as discussed." } });
    fireEvent.click(screen.getByTestId("send-quote-email-button"));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith({ subject: "Quote for the beach house", message: "Two options inside, as discussed." }));
  });
});
