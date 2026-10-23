import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "fs";
import { resolve } from "path";

const rpc = vi.fn();
const navigate = vi.fn();
const toast = vi.fn();
const customer = { name: "TEST Builders", company_name: "TEST Builders", vat_number: "4000000001", primary_address_line1: "1 Old Rd", primary_address_line2: "", city: "Cape Town", postal_code: "8001", email: "a@b.c", phone: "021" };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: any[]) => rpc(...a),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { customer_id: "c1", customers: customer } }) }) }) }),
  },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<any>()), useNavigate: () => navigate }));

import QuoteAcceptedLock, { lockHeadline } from "@/components/quoting/QuoteAcceptedLock";
import { isQuoteReadOnly, fetchQuoteLockState, type QuoteLockState } from "@/hooks/useQuoteLock";

const base: QuoteLockState = {
  state: "accepted_locked", status: "accepted", locked_at: "2026-10-16T10:00:00Z", locked_reason: "accepted",
  invoice_number: null, invoice_status: null, is_admin: false, can_edit: false, can_unlock: false, can_relock: false,
  can_variation: false, can_correct_client: false, last_unlock: null, variations: [], parent: null, is_variation: false, variation_kind: null,
};
const admin = (o: Partial<QuoteLockState> = {}): QuoteLockState => ({ ...base, is_admin: true, can_unlock: true, can_variation: true, can_correct_client: true, ...o });
const show = (lock: QuoteLockState | null, onChanged = vi.fn()) =>
  render(<MemoryRouter><QuoteAcceptedLock quoteId="q1" lock={lock} onChanged={onChanged} /></MemoryRouter>);

beforeEach(() => { rpc.mockReset(); navigate.mockReset(); toast.mockReset(); });

describe("lock state helpers", () => {
  it("headline per state", () => {
    expect(lockHeadline(base)).toBe("Locked: accepted");
    expect(lockHeadline({ ...base, state: "invoiced", invoice_number: "INV-036", invoice_status: "paid" })).toBe("Locked: invoiced (INV-036 paid)");
    expect(lockHeadline({ ...base, state: "accepted_unlocked", can_edit: false })).toBe("Locked: accepted");
    expect(lockHeadline({ ...base, state: "accepted_unlocked", can_edit: true })).toBe("Unlocked for editing (admin)");
    expect(lockHeadline({ ...base, state: "open", can_edit: true })).toBeNull();
  });
  it("read-only only when the server says can_edit=false; unknown state keeps old behaviour", () => {
    expect(isQuoteReadOnly(base)).toBe(true);
    expect(isQuoteReadOnly({ ...base, can_edit: true })).toBe(false);
    expect(isQuoteReadOnly(null)).toBe(false);
  });
  it("RPC missing (0029 not applied yet) -> null, no crash", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "function quote_lock_state does not exist" } });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await fetchQuoteLockState("q1")).toBeNull();
    warn.mockRestore();
  });
});

describe("QuoteAcceptedLock banner", () => {
  it("rep: Locked: accepted, no admin buttons", () => {
    show(base);
    expect(screen.getByTestId("quote-accepted-lock").textContent).toContain("Locked: accepted");
    expect(screen.getByText(/Only an admin can change it/)).toBeTruthy();
    expect(screen.queryByTestId("admin-lock-actions")).toBeNull();
  });
  it("open quote: nothing rendered", () => {
    const { container } = show({ ...base, state: "open", can_edit: true, locked_at: null });
    expect(container.textContent).toBe("");
  });
  it("admin unlock needs a reason, calls unlock_quote and refreshes", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const onChanged = vi.fn();
    show(admin(), onChanged);
    fireEvent.click(screen.getByText("Unlock to edit"));
    const dlg = await screen.findByTestId("unlock-dialog");
    const confirm = screen.getByRole("button", { name: "Unlock" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(dlg.querySelector("textarea")!, { target: { value: "Client asked for an extra unit" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("unlock_quote", { p_quote_id: "q1", p_reason: "Client asked for an extra unit" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
  it("admin create variation navigates to the new draft", async () => {
    rpc.mockResolvedValue({ data: { quote_id: "q-var", quote_number: "Q-2026-0099" }, error: null });
    show(admin());
    fireEvent.click(screen.getByText("Create variation"));
    const dlg = await screen.findByTestId("variation-dialog");
    fireEvent.change(dlg.querySelector("textarea")!, { target: { value: "Second unit in the office" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Create variation" }).at(-1)!);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("admin_create_quote_variation", { p_quote_id: "q1", p_reason: "Second unit in the office" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/admin/estimates/q-var"));
  });
  it("invoiced: no unlock, variation + client details only", () => {
    show(admin({ state: "invoiced", can_unlock: false, invoice_number: "INV-036", invoice_status: "paid" }));
    expect(screen.getByText(/Locked: invoiced \(INV-036 paid\)/)).toBeTruthy();
    expect(screen.queryByText("Unlock to edit")).toBeNull();
    expect(screen.getByText("Create variation")).toBeTruthy();
    expect(screen.getByText(/variation; less work on a credit note/)).toBeTruthy();
  });
  it("unlocked: admin sees Lock again and who unlocked", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    show(admin({ state: "accepted_unlocked", can_edit: true, can_unlock: false, can_relock: true, last_unlock: { at: "2026-10-23T10:00:00Z", reason: "extra unit", by: "Johan" } }));
    expect(screen.getByTestId("last-unlock").textContent).toContain("Johan");
    fireEvent.click(screen.getByText("Lock again"));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("relock_quote", { p_quote_id: "q1" }));
  });
  it("client details: sends only changed fields + reason, warns that the issued invoice was not changed", async () => {
    rpc.mockResolvedValue({ data: { draft_invoices_updated: 0, issued_invoices_unchanged: [{ invoice_number: "INV-036", status: "paid" }] }, error: null });
    show(admin({ state: "invoiced", can_unlock: false, invoice_number: "INV-036", invoice_status: "paid" }));
    fireEvent.click(screen.getByText("Edit client details"));
    const vat = await screen.findByLabelText("VAT number");
    await waitFor(() => expect((vat as HTMLInputElement).value).toBe("4000000001"));
    fireEvent.change(vat, { target: { value: "4111111111" } });
    fireEvent.change(screen.getByLabelText("Reason for the correction"), { target: { value: "Client sent VAT certificate" } });
    fireEvent.click(screen.getByRole("button", { name: "Save 1 change" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("admin_correct_client_details", { p_quote_id: "q1", p_changes: { vat_number: "4111111111" }, p_reason: "Client sent VAT certificate" }));
    await waitFor(() => expect(toast.mock.calls.at(-1)?.[0].description).toMatch(/INV-036 \(paid\) already went out and was not changed/));
  });
  it("variation links both ways", () => {
    show({ ...base, state: "open", can_edit: true, locked_at: null, parent: { id: "p1", quote_number: "Q-2026-0036" }, variation_kind: "admin_variation" });
    expect(screen.getByTestId("variation-parent").textContent).toContain("Q-2026-0036");
    show(admin({ variations: [{ id: "v1", quote_number: "Q-2026-0099", status: "draft", total: 1150 }] }));
    expect(screen.getByTestId("variation-links").textContent).toContain("Q-2026-0099");
  });
});

describe("wiring (source checks)", () => {
  const src = (p: string) => readFileSync(resolve(__dirname, "..", p), "utf8");
  it("estimate page: banner, inert editor, no Save / Full builder when read-only", () => {
    const s = src("pages/admin/AdminEstimateDetailPage.tsx");
    expect(s).toMatch(/<QuoteAcceptedLock quoteId=\{quote.id\} lock=\{lock\}/);
    expect(s).toMatch(/inertIf\(readOnly\)/);
    expect(s).toMatch(/hideSave=\{readOnly\}/);
    expect(s).toMatch(/\{!readOnly && <Button variant="outline" onClick=\{\(\) => navigate\(`\/admin\/quote-builder/);
  });
  it("builder never opens a locked quote (it autosaves)", () => {
    const s = src("pages/admin/AdminQuoteBuilderPageUnified.tsx");
    expect(s).toMatch(/if \(isQuoteReadOnly\(quoteLock\)\)/);
    expect(s.indexOf("useQuoteLock(quoteId)")).toBeLessThan(s.indexOf("if (needsClient)"));
  });
  it("bulk delete only touches drafts", () => {
    expect(src("components/quoting/QuotesList.tsx")).toMatch(/d\.kind === "estimate" && String\(\(d as any\)\.status \|\| ""\)\.toLowerCase\(\) === "draft"/);
  });
  it("old site-check banner no longer uses window.prompt and skips accepted locks", () => {
    const s = src("components/quoting/QuoteLockBanner.tsx");
    expect(s).not.toMatch(/window\.prompt/);
    expect(s).toMatch(/lockedReason === "accepted"\) return null/);
  });
  it("migration enforces on the server and ships a rollback", () => {
    const m = readFileSync(resolve(__dirname, "../../drizzle/migrations/0029_quote_lock_after_accept.sql"), "utf8");
    for (const t of ["trg_quote_areas_lock_guard", "trg_quote_line_items_lock_guard", "trg_proposal_sections_lock_guard", "trg_quotes_autolock_on_accept", "trg_customers_billing_guard"]) expect(m).toContain(t);
    const r = readFileSync(resolve(__dirname, "../../drizzle/rollback/0029_quote_lock_after_accept_rollback.sql"), "utf8");
    expect(r).toContain("DROP TRIGGER IF EXISTS trg_customers_billing_guard");
  });
});
