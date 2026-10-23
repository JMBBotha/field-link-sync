// Admin Delete / Archive quote (0027): helpers, menu gating, delete + archive dialogs, banner.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  isAdmin: true,
  rpc: vi.fn(),
  remove: vi.fn(),
  storageFrom: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...a: any[]) => h.rpc(...a),
    storage: { from: (b: string) => { h.storageFrom(b); return { remove: (p: string[]) => h.remove(b, p) }; } },
  },
}));
vi.mock("@/hooks/useRole", () => ({ useRole: () => ({ isAdmin: h.isAdmin, roles: h.isAdmin ? ["admin"] : ["dispatcher"], loading: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: h.toast }) }));

import { confirmWord, confirmMatches, reasonOk, deletionLines, deleteArchiveMenu } from "@/lib/quoteDeleteArchive";
import { useQuoteDeleteArchive, ArchivedQuoteBanner } from "@/components/quoting/QuoteDeleteArchive";

const Q = { id: "q1", quote_number: "Q-2026-0099", archived_at: null as string | null };
const okCheck = {
  can_delete: true, reasons: [], photos_optional: true, quote_id: "q1", quote_number: "Q-2026-0099", status: "draft", archived: false,
  counts: { items: 4, areas: 2, draft_invoices: 1, notifications: 3, visit_photos: 2, versions: 0 },
};

function Harness({ quote = Q, onDeleted }: { quote?: typeof Q; onDeleted?: (id: string) => void }) {
  const da = useQuoteDeleteArchive({ onDeleted });
  return (
    <div>
      {da.itemsFor(quote).filter((i) => !i.hidden).map((i) => <button key={i.label} onClick={i.onSelect}>{i.label}</button>)}
      {da.dialogs}
    </div>
  );
}
const mount = (el: React.ReactElement) => render(<QueryClientProvider client={new QueryClient()}>{el}</QueryClientProvider>);

beforeEach(() => {
  h.isAdmin = true; h.rpc.mockReset(); h.remove.mockReset(); h.storageFrom.mockReset(); h.toast.mockReset();
  h.remove.mockResolvedValue({ data: [], error: null });
});

describe("quoteDeleteArchive helpers", () => {
  it("confirm word is the quote number, else DELETE; match is case-insensitive and trimmed", () => {
    expect(confirmWord({ quote_number: "Q-2026-0099" })).toBe("Q-2026-0099");
    expect(confirmWord({ quote_number: null })).toBe("DELETE");
    expect(confirmMatches(" q-2026-0099 ", { quote_number: "Q-2026-0099" })).toBe(true);
    expect(confirmMatches("Q-2026-009", { quote_number: "Q-2026-0099" })).toBe(false);
    expect(confirmMatches("delete", { quote_number: "" })).toBe(true);
  });
  it("reason needs 3+ characters", () => {
    expect(reasonOk("  ab ")).toBe(false);
    expect(reasonOk("abc")).toBe(true);
  });
  it("deletion lines pluralise and skip zeros", () => {
    expect(deletionLines({ items: 1, areas: 2, versions: 0, draft_invoices: 1 })).toEqual(["1 line item", "2 areas", "1 draft invoice (never sent)"]);
    expect(deletionLines(undefined)).toEqual([]);
  });
  it("menu: admin only; archived quotes offer only unarchive", () => {
    expect(deleteArchiveMenu(Q, false)).toEqual({ del: false, archive: false, unarchive: false });
    expect(deleteArchiveMenu(Q, true)).toEqual({ del: true, archive: true, unarchive: false });
    expect(deleteArchiveMenu({ ...Q, archived_at: "2026-10-23T10:00:00Z" }, true)).toEqual({ del: false, archive: false, unarchive: true });
  });
});

describe("useQuoteDeleteArchive", () => {
  it("non-admins (incl. office/dispatcher) get no menu entries", () => {
    h.isAdmin = false;
    mount(<Harness />);
    expect(screen.queryByText("Delete quote…")).toBeNull();
    expect(screen.queryByText("Archive quote…")).toBeNull();
  });

  it("delete: lists what goes, needs reason + typed quote number, then deletes and removes files", async () => {
    const onDeleted = vi.fn();
    h.rpc.mockImplementation((fn: string) => fn === "quote_delete_check"
      ? Promise.resolve({ data: okCheck, error: null })
      : Promise.resolve({ data: { deleted: true, storage: { "quote-photos": ["c/q1/a.jpg"], "quote-documents": [], "job-photos": ["c/l/v.jpg"] } }, error: null }));
    mount(<Harness onDeleted={onDeleted} />);
    fireEvent.click(screen.getByText("Delete quote…"));
    const dlg = await screen.findByTestId("quote-delete-dialog");
    expect(h.rpc).toHaveBeenCalledWith("quote_delete_check", { p_quote: "q1" });
    expect(within(dlg).getByText("Delete Q-2026-0099 permanently?")).toBeTruthy();
    const lines = within(dlg).getByTestId("delete-lines").textContent!;
    expect(lines).toContain("4 line items");
    expect(lines).toContain("1 draft invoice (never sent)");
    expect(lines).toContain("3 alerts");
    expect(lines).not.toContain("saved version");
    const btn = within(dlg).getByRole("button", { name: /Delete permanently/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(within(dlg).getByLabelText("Reason"), { target: { value: "Test quote" } });
    expect(btn.disabled).toBe(true);
    fireEvent.change(within(dlg).getByLabelText(/to confirm/), { target: { value: "Q-2026-009" } });
    expect(btn.disabled).toBe(true);
    fireEvent.change(within(dlg).getByLabelText(/to confirm/), { target: { value: "q-2026-0099" } });
    expect(btn.disabled).toBe(false);
    fireEvent.click(within(dlg).getByLabelText("Also delete visit photos"));
    fireEvent.click(btn);
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("q1"));
    expect(h.rpc).toHaveBeenCalledWith("quote_delete", { p_quote: "q1", p_reason: "Test quote", p_delete_photos: true });
    expect(h.remove).toHaveBeenCalledWith("quote-photos", ["c/q1/a.jpg"]);
    expect(h.remove).toHaveBeenCalledWith("job-photos", ["c/l/v.jpg"]);
    expect(h.storageFrom).not.toHaveBeenCalledWith("quote-documents");
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Q-2026-0099 deleted" }));
  });

  it("delete on a blocked quote opens the archive dialog with the reasons instead", async () => {
    h.rpc.mockImplementation((fn: string) => fn === "quote_delete_check"
      ? Promise.resolve({ data: { ...okCheck, can_delete: false, reasons: ["Has invoice INV-040 (paid)", "Has 1 payment"] }, error: null })
      : Promise.resolve({ data: { archived: true }, error: null }));
    mount(<Harness />);
    fireEvent.click(screen.getByText("Delete quote…"));
    const dlg = await screen.findByTestId("quote-archive-dialog");
    expect(screen.queryByTestId("quote-delete-dialog")).toBeNull();
    const reasons = within(dlg).getByTestId("archive-only-reasons").textContent!;
    expect(reasons).toContain("Has invoice INV-040 (paid)");
    expect(reasons).toContain("Has 1 payment");
    expect(h.rpc).not.toHaveBeenCalledWith("quote_delete", expect.anything());
  });

  it("archive: needs a reason, calls quote_archive, toast offers Undo", async () => {
    h.rpc.mockResolvedValue({ data: { archived: true }, error: null });
    mount(<Harness />);
    fireEvent.click(screen.getByText("Archive quote…"));
    const dlg = await screen.findByTestId("quote-archive-dialog");
    expect(within(dlg).queryByTestId("archive-only-reasons")).toBeNull();
    const btn = within(dlg).getByRole("button", { name: "Archive" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(within(dlg).getByLabelText("Reason"), { target: { value: "Client went elsewhere" } });
    fireEvent.click(btn);
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("quote_archive", { p_quote: "q1", p_reason: "Client went elsewhere" }));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Q-2026-0099 archived", action: expect.anything() })));
  });

  it("archived quote: only Unarchive, which calls quote_unarchive", async () => {
    h.rpc.mockResolvedValue({ data: { unarchived: true }, error: null });
    mount(<Harness quote={{ ...Q, archived_at: "2026-10-23T10:00:00Z" }} />);
    expect(screen.queryByText("Delete quote…")).toBeNull();
    fireEvent.click(screen.getByText("Unarchive quote"));
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith("quote_unarchive", { p_quote: "q1" }));
  });

  it("server errors surface as a toast and nothing is deleted", async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: "Only an admin can delete or archive quotes" } });
    mount(<Harness />);
    fireEvent.click(screen.getByText("Delete quote…"));
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ description: "Only an admin can delete or archive quotes", variant: "destructive" })));
    expect(screen.queryByTestId("quote-delete-dialog")).toBeNull();
  });
});

describe("ArchivedQuoteBanner", () => {
  it("renders only for archived quotes, with reason and Unarchive", () => {
    const un = vi.fn();
    const { rerender } = render(<ArchivedQuoteBanner quote={{ archived_at: null }} onUnarchive={un} />);
    expect(screen.queryByTestId("archived-banner")).toBeNull();
    rerender(<ArchivedQuoteBanner quote={{ archived_at: "2026-10-23T10:00:00Z", archive_reason: "Duplicate" }} onUnarchive={un} />);
    expect(screen.getByTestId("archived-banner").textContent).toContain("23 Oct 2026 · Duplicate");
    fireEvent.click(screen.getByRole("button", { name: "Unarchive" }));
    expect(un).toHaveBeenCalled();
  });
});
