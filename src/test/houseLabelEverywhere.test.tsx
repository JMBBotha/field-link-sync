import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { writeFileSync, mkdirSync } from "fs";
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));
import { BalanceDueBlock } from "@/components/invoicing/BalanceDueBlock";
import { InvoicePicker } from "@/components/invoicing/AddPaymentDialog";

const b: any = { invoice_id: "i1", invoice_number: "0010015", status: "sent", total: 100000, is_balance: false, deposit_amount: 50000, deposit_paid: 50000, deposit_paid_at: "2026-10-20T08:00:00Z", paid_total: 50000, balance: 50000, job_id: "j", job_status: "scheduled", install_at: "2026-11-10T07:00:00Z", job_done: null, due: null, due_manual: false, waiting: true, stored_due: null, days: null, terms_basis: null, terms_days: null, reminder_due: false, followup_id: null, followup_status: null, followup_step: null, can_edit_install: false, can_edit_due: false, is_admin: true };

describe("house label on invoice surfaces (display only)", () => {
  it("shows House first on the payment card and picker", () => {
    const qc = new QueryClient();
    qc.setQueryData(["invoice-balance", "i1"], b);
    qc.setQueryData(["invoice-house", "i1"], "House 35");
    const { container } = render(<QueryClientProvider client={qc}><div style={{ width: 520, padding: 16 }}>
      <BalanceDueBlock invoiceId="i1" />
      <InvoicePicker invoices={[{ id: "i1", invoice_number: "0010015", grand_total: 100000, amount_due: 50000, house: "House 35" }]} pick="i1" onPick={() => {}} />
    </div></QueryClientProvider>);
    expect(screen.getByTestId("balance-house").textContent).toContain("House 35");
    expect(container.textContent).toMatch(/House 35.*Payment & installation.*0010015/);
    if (process.env.HOUSE_SHOT) { mkdirSync("/workspace/house-label-shots", { recursive: true }); writeFileSync("/workspace/house-label-shots/surfaces.html", container.innerHTML); }
  });
});
