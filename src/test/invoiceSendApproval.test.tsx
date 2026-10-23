import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const rpc = vi.fn();
const navigate = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: any[]) => rpc(...a),
    from: () => ({ select: () => ({ in: () => ({ gte: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }),
    channel: () => ({ on: function () { return this; }, subscribe: function () { return this; } }),
    removeChannel: vi.fn(),
  },
}));
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<any>()), useNavigate: () => navigate }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import {
  alertTitle, statusLine, resultMessage, minutesLeft, sortApprovals, sendInvoiceNow, holdInvoiceSend, fmtTime,
  type InvoiceSendApproval,
} from "@/lib/invoiceSendApproval";
import { InvoiceApprovalList } from "@/components/invoicing/InvoiceApprovalPanel";
import InvoiceApprovalActions, { EDIT_HOLD_REASON } from "@/components/invoicing/InvoiceApprovalActions";
import { notificationHref } from "@/components/notifications/NotificationsList";
import { clampMinutes } from "@/components/settings/InvoiceAutoSendCard";

const NOW = Date.parse("2026-10-23T15:20:00Z"); // 17:20 SAST
const base: InvoiceSendApproval = {
  id: "a1", invoice_id: "inv-1", quote_id: "q-1", client_name: "Test Client", quote_number: "Q-0101", invoice_number: "INV-042",
  deposit_amount: 27421.32, status: "pending", due_at: "2026-10-23T15:32:00Z", decision: null, decided_by: null,
  decided_at: null, hold_reason: null, last_error: null, created_at: "2026-10-23T15:17:00Z",
};
const wrap = (ui: React.ReactNode) =>
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);

beforeEach(() => { rpc.mockReset(); navigate.mockReset(); });

describe("invoiceSendApproval helpers", () => {
  it("alert title is '<Client> accepted Q-xxxx'", () => {
    expect(alertTitle(base)).toBe("Test Client accepted Q-0101");
  });
  it("shows the SAST auto-send time and minutes left", () => {
    expect(fmtTime(base.due_at!)).toBe("17:32");
    expect(minutesLeft(base.due_at, NOW)).toBe(12);
    expect(statusLine(base, NOW)).toBe("Sends automatically at 17:32 (in 12 min)");
    expect(statusLine({ ...base, due_at: "2026-10-23T15:19:00Z" }, NOW)).toBe("Sending now…");
  });
  it("explains held, blocked and auto-send off", () => {
    expect(statusLine({ ...base, status: "held", due_at: null, decided_at: "2026-10-23T15:21:00Z", hold_reason: "Client changing unit" }, NOW))
      .toBe("On hold since 17:21 · Client changing unit. Won't send until someone sends it.");
    expect(statusLine({ ...base, status: "blocked", last_error: "no client email" }, NOW)).toContain("Didn't send: no client email");
    expect(statusLine({ ...base, due_at: null }, NOW)).toContain("Nothing has been sent yet");
  });
  it("maps RPC results to plain messages (double tap is not an error)", () => {
    expect(resultMessage("sent")).toEqual({ ok: true, text: "Invoice sent to the client" });
    expect(resultMessage("already_sent").ok).toBe(true);
    expect(resultMessage("blocked:no client email")).toEqual({ ok: false, text: "Not sent: no client email" });
  });
  it("sorts pending (soonest first) before blocked before held", () => {
    const rows = [
      { ...base, id: "h", status: "held" as const },
      { ...base, id: "p2", due_at: "2026-10-23T15:40:00Z" },
      { ...base, id: "b", status: "blocked" as const },
      { ...base, id: "p1" },
    ];
    expect(sortApprovals(rows).map((r) => r.id)).toEqual(["p1", "p2", "b", "h"]);
  });
  it("clamps the admin minutes setting to 0..1440", () => {
    expect(clampMinutes("15")).toBe(15);
    expect(clampMinutes(-3)).toBe(0);
    expect(clampMinutes(99999)).toBe(1440);
  });
});

describe("RPC wrappers", () => {
  it("send now calls invoice_send_now once with the invoice id", async () => {
    rpc.mockResolvedValue({ data: { result: "sent" }, error: null });
    await expect(sendInvoiceNow("inv-1")).resolves.toBe("sent");
    expect(rpc).toHaveBeenCalledWith("invoice_send_now", { p_invoice_id: "inv-1" });
  });
  it("hold passes the optional reason", async () => {
    rpc.mockResolvedValue({ data: { result: "held" }, error: null });
    await holdInvoiceSend("inv-1", "wait for site visit");
    expect(rpc).toHaveBeenCalledWith("invoice_send_hold", { p_invoice_id: "inv-1", p_reason: "wait for site visit" });
  });
  it("surfaces permission errors (POPIA: other company / other rep)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "Not allowed to send this invoice" } });
    await expect(sendInvoiceNow("inv-1")).rejects.toThrow("Not allowed");
  });
});

describe("InvoiceApprovalList (attention panel)", () => {
  it("renders the alert with Send invoice now / Edit / Hold and the countdown", () => {
    wrap(<InvoiceApprovalList items={[base]} now={NOW} />);
    expect(screen.getByText("Test Client accepted Q-0101")).toBeInTheDocument();
    expect(screen.getByText(/INV-042 · deposit R 27 421,32 · Sends automatically at 17:32 \(in 12 min\)/)).toBeInTheDocument();
    for (const b of ["Send invoice now", "Edit", "Hold"]) expect(screen.getByRole("button", { name: new RegExp(b) })).toBeInTheDocument();
  });
  it("held rows have no Hold button but can still be sent", () => {
    wrap(<InvoiceApprovalList items={[{ ...base, status: "held", due_at: null }]} now={NOW} />);
    expect(screen.queryByRole("button", { name: /Hold/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Send invoice now/ })).toBeInTheDocument();
  });
  it("renders nothing when there is nothing to send", () => {
    const { container } = wrap(<InvoiceApprovalList items={[]} now={NOW} />);
    expect(container.querySelector("[data-testid=invoice-approvals]")).toBeNull();
  });
});

describe("InvoiceApprovalActions", () => {
  it("Send invoice now calls the RPC", async () => {
    rpc.mockResolvedValue({ data: { result: "sent" }, error: null });
    wrap(<InvoiceApprovalActions invoiceId="inv-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Send invoice now/ }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("invoice_send_now", { p_invoice_id: "inv-1" }));
  });
  it("Hold asks for an optional reason; cancelling the prompt does nothing", async () => {
    const prompt = vi.spyOn(window, "prompt").mockReturnValueOnce(null).mockReturnValueOnce("");
    rpc.mockResolvedValue({ data: { result: "held" }, error: null });
    wrap(<InvoiceApprovalActions invoiceId="inv-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Hold/ }));
    expect(rpc).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Hold/ }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("invoice_send_hold", { p_invoice_id: "inv-1", p_reason: "" }));
    prompt.mockRestore();
  });
  it("Edit pauses the auto-send and opens the invoice", async () => {
    rpc.mockResolvedValue({ data: { result: "held" }, error: null });
    wrap(<InvoiceApprovalActions invoiceId="inv-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Edit/ }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/admin/invoices/inv-1"));
    expect(rpc).toHaveBeenCalledWith("invoice_send_hold", { p_invoice_id: "inv-1", p_reason: EDIT_HOLD_REASON });
  });
});

describe("bell routing", () => {
  it("accepted-quote alerts open the invoice (related_id is the invoice id), not the quote", () => {
    expect(notificationHref("quote_accepted_send_invoice", "inv-1")).toBe("/admin/invoices/inv-1");
    expect(notificationHref("invoice_send_blocked", "inv-1")).toBe("/admin/invoices/inv-1");
  });
});

describe("0025 migration: one alert on client online accept", () => {
  it("accept_quote_by_token folds 'accepted online' into the invoice alert and only falls back to quote_accepted_client", async () => {
    const fs = await import("node:fs");
    const sql = fs.readFileSync("drizzle/migrations/0025_accept_invoice_approval.sql", "utf8");
    const fn = sql.slice(sql.indexOf("FUNCTION public.accept_quote_by_token"), sql.indexOf("-- Accept path: identical"));
    expect(fn).toMatch(/IF v_appr IS NOT NULL THEN/);
    expect(fn).toMatch(/accepted online\. /);
    expect(fn.indexOf("quote_accepted_client")).toBeGreaterThan(fn.indexOf("ELSE"));
    const rb = fs.readFileSync("drizzle/rollback/0025_accept_invoice_approval_rollback.sql", "utf8");
    expect(rb).toContain("FUNCTION public.accept_quote_by_token");
  });
});
