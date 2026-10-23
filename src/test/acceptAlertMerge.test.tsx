import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fs from "node:fs";

const navigate = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(),
    from: () => ({ select: () => ({ in: () => ({ gte: () => ({ limit: async () => ({ data: [], error: null }) }) }), eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    channel: () => ({ on: function () { return this; }, subscribe: function () { return this; } }),
    removeChannel: vi.fn(),
  },
}));
vi.mock("react-router-dom", async (orig) => ({ ...(await orig<any>()), useNavigate: () => navigate }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/calls/CallRecordingPlayer", () => ({ default: () => null }));

import NotificationsList, { handoverLinkOf } from "@/components/notifications/NotificationsList";

const alert = (meta: any, extra: any = {}) => ({
  id: "n1", user_id: "u1", type: "quote_accepted_send_invoice", title: "Hennie accepted Q-2026-0046",
  body: "Invoice INV-042 (deposit R 27 421,32) is ready.", related_id: "inv-1", read: false,
  created_at: new Date().toISOString(), metadata: meta, ...extra,
});
const wrap = (ui: React.ReactNode) =>
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);

beforeEach(() => navigate.mockReset());

describe("0026: single accept alert keeps the hand-to-technician link", () => {
  it("handoverLinkOf only returns safe visit/estimate links on the accept alert", () => {
    expect(handoverLinkOf({ type: "quote_accepted_send_invoice", metadata: { handover_link: "/admin/visits/abc-1" } })).toBe("/admin/visits/abc-1");
    expect(handoverLinkOf({ type: "quote_accepted_send_invoice", metadata: { handover_link: "/admin/estimates/q-9" } })).toBe("/admin/estimates/q-9");
    expect(handoverLinkOf({ type: "quote_accepted_send_invoice", metadata: {} })).toBeNull();
    expect(handoverLinkOf({ type: "quote_accepted_send_invoice", metadata: { handover_link: "https://evil.example/x" } })).toBeNull();
    expect(handoverLinkOf({ type: "quote_status_change", metadata: { handover_link: "/admin/visits/abc" } })).toBeNull();
  });

  it("shows 'Hand to technician' and opens the visit", () => {
    const onClose = vi.fn();
    wrap(<NotificationsList notifications={[alert({ invoice_id: "inv-1", handover_link: "/admin/visits/lead-7" }) as any]}
      onMarkAsRead={vi.fn()} onMarkAllRead={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("hand-to-technician"));
    expect(navigate).toHaveBeenCalledWith("/admin/visits/lead-7");
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps the link after the alert is read (invoice already sent)", () => {
    wrap(<NotificationsList notifications={[alert({ handover_link: "/admin/visits/lead-7" }, { read: true }) as any]}
      onMarkAsRead={vi.fn()} onMarkAllRead={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId("hand-to-technician")).toBeTruthy();
  });

  it("no button when the quote already has an installation job (no handover_link)", () => {
    wrap(<NotificationsList notifications={[alert({ invoice_id: "inv-1" }) as any]}
      onMarkAsRead={vi.fn()} onMarkAllRead={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByTestId("hand-to-technician")).toBeNull();
  });
});

describe("0026 migration + rollback (static)", () => {
  const sql = fs.readFileSync("drizzle/migrations/0026_accept_alert_merge.sql", "utf8");
  const rb = fs.readFileSync("drizzle/rollback/0026_accept_alert_merge_rollback.sql", "utf8");
  it("deposit uses SA format, handover_link in metadata, old notices skipped on accept", () => {
    expect(sql).toMatch(/fmt_rand_sql\(v_dep\)/);
    expect(sql).not.toMatch(/FM999999990\.00/);
    expect(sql).toMatch(/'handover_link', v_handover/);
    expect((sql.match(/app\.isa_alerted_quotes/g) || []).length).toBeGreaterThanOrEqual(4);
    expect(sql).toMatch(/FUNCTION public\.p3_notify_quote_accepted/);
    expect(sql).toMatch(/FUNCTION public\.notify_quote_status_change/);
  });
  it("rollback restores all three functions with the old deposit format", () => {
    for (const f of ["isa_queue", "p3_notify_quote_accepted", "notify_quote_status_change"]) expect(rb).toContain(`FUNCTION public.${f}`);
    expect(rb).not.toMatch(/isa_alerted_quotes/);
    expect(rb).toMatch(/FM999999990\.00/);
  });
});
