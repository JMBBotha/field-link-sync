import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BalanceDueBlock } from "@/components/invoicing/BalanceDueBlock";
const info = (balance: number, status = "partially_paid") => ({ invoice_id: "i1", invoice_number: "INV-D-1", status, balance, deposit_amount: 0, deposit_paid: 0, is_balance: true, job_done: null, install_at: null, due: null, due_manual: false, reminder_due: false } as any);
function mount(b: any, fn?: () => void) {
  const qc = new QueryClient(); qc.setQueryData(["invoice-balance", "i1"], b);
  qc.setDefaultOptions({ queries: { staleTime: Infinity, enabled: false } });
  return render(<QueryClientProvider client={qc}><BalanceDueBlock invoiceId="i1" onRecordPayment={fn} /></QueryClientProvider>);
}
describe("Final payment tile Record payment", () => {
  it("shows when balance > 0 and calls the handler", () => { const fn = vi.fn(); mount(info(1000), fn); fireEvent.click(screen.getByTestId("final-tile-record-payment")); expect(fn).toHaveBeenCalled(); });
  it("hidden when paid, or no handler", () => { mount(info(0, "paid"), vi.fn()); expect(screen.queryByTestId("final-tile-record-payment")).toBeNull(); });
  it("hidden without handler", () => { mount(info(500)); expect(screen.queryByTestId("final-tile-record-payment")).toBeNull(); });
});
