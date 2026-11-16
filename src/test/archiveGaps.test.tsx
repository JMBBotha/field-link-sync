import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ArchivedRecordBanner } from "@/components/archive/ArchivedRecordBanner";
import { PublicUnavailable } from "@/components/archive/PublicUnavailable";
import { ArchivedQuoteBanner } from "@/components/quoting/QuoteDeleteArchive";
import {
  autoArchiveReason, invoiceInAgingReport, isAutoArchive, quoteHiddenByClosedLead, summariseInvoiceAging,
} from "@/lib/archiveGaps";
import { buildDeals } from "@/lib/quotePipeline";

const sql = readFileSync("supabase/migrations/20261116160000_archive_gaps.sql", "utf8");
const rollback = readFileSync("supabase/manual/20261116160000_archive_gaps_rollback.sql", "utf8");

describe("auto-archive undo", () => {
  it("uses the configured day count and treats the flag and the live reason as auto", () => {
    expect(autoArchiveReason(45)).toBe("Auto-archived: 45 days no activity");
    expect(autoArchiveReason(null)).toBe("Auto-archived: 60 days no activity");
    expect(isAutoArchive({ auto_archived: true, archive_reason: "Client went elsewhere" })).toBe(true);
    expect(isAutoArchive({ archive_reason: "Auto-archived: 60 days no activity" })).toBe(true);
    expect(isAutoArchive({ archive_reason: "Auto: Cold, no reply 60 days" })).toBe(true);
    expect(isAutoArchive({ archive_reason: "Duplicate" })).toBe(false);
    expect(sql).toContain("format('Auto-archived: %s days no activity', r.archive_days)");
    expect(sql).toContain("auto_archived = true");
    expect(sql).toContain("LIKE 'Auto-archived:%'");
    expect(sql).not.toContain("archive_reason = 'Auto-archived: 60 days no activity'");
  });
});

describe("closed or dismissed lead", () => {
  const q = (over: Record<string, unknown>) => ({ id: "q", status: "sent", total: 1000, created_at: "2026-11-01", ...over });

  it("drops an open quote and keeps a booked job and a live invoice", () => {
    expect(quoteHiddenByClosedLead({ leadClosed: true, stage: "sent", invoiced: false, booked: false })).toBe(true);
    expect(quoteHiddenByClosedLead({ leadClosed: true, stage: "accepted", invoiced: false, booked: false })).toBe(true);
    expect(quoteHiddenByClosedLead({ leadClosed: true, stage: "booked", invoiced: false, booked: true })).toBe(false);
    expect(quoteHiddenByClosedLead({ leadClosed: true, stage: "accepted", invoiced: true, booked: false })).toBe(false);
    expect(quoteHiddenByClosedLead({ leadClosed: false, stage: "sent", invoiced: false, booked: false })).toBe(false);

    const deals = buildDeals([
      q({ id: "open", lead_closed_at: "2026-11-14" }),
      q({ id: "dismissed", status: "viewed", lead_dismissed_at: "2026-11-14" }),
      q({ id: "booked", status: "accepted", lead_closed_at: "2026-11-14" }),
      q({ id: "invoiced", status: "accepted", lead_closed_at: "2026-11-14" }),
      q({ id: "voided", status: "draft", lead_closed_at: "2026-11-14" }),
      q({ id: "live", status: "draft" }),
    ] as any, [
      { quote_id: "invoiced", status: "sent", grand_total: 500 },
      { quote_id: "voided", status: "void", grand_total: 500 },
      { quote_id: "booked", status: "cancelled", archived_at: "2026-11-01" },
    ], [
      { quote_id: "booked", status: "scheduled" },
    ]);
    expect(deals.map((d) => d.quote.id).sort()).toEqual(["booked", "invoiced", "live"]);
  });

  it("brings the quote back when the lead is restored", () => {
    const closed = buildDeals([q({ id: "back", lead_closed_at: "2026-11-14", status: "draft" })] as any, [], []);
    const restored = buildDeals([q({ id: "back", lead_closed_at: null, status: "draft" })] as any, [], []);
    expect(closed).toHaveLength(0);
    expect(restored.map((d) => d.quote.id)).toEqual(["back"]);
  });
});

describe("invoice ageing", () => {
  const today = "2026-11-16";
  it("leaves out archived, void, and cancelled invoices", () => {
    expect(invoiceInAgingReport({ status: "overdue", due_date: "2026-10-01", archived_at: null })).toBe(true);
    expect(invoiceInAgingReport({ status: "overdue", due_date: "2026-10-01", archived_at: "2026-11-14" })).toBe(false);
    expect(invoiceInAgingReport({ status: "void", due_date: "2026-10-01" })).toBe(false);
    expect(invoiceInAgingReport({ status: "cancelled", due_date: "2026-10-01" })).toBe(false);
    expect(invoiceInAgingReport({ status: "canceled", due_date: "2026-10-01" })).toBe(false);
    expect(invoiceInAgingReport({ status: "paid", due_date: "2026-10-01" })).toBe(false);
    const rows = summariseInvoiceAging([
      { status: "overdue", due_date: "2026-10-01", outstanding: 100, invoice_number: "live" } as any,
      { status: "overdue", due_date: "2026-09-01", outstanding: 999, archived_at: "2026-11-14" },
      { status: "void", due_date: "2026-08-01", outstanding: 50 },
    ], today);
    expect(rows.find((r) => r.bracket === "31-60 days")).toMatchObject({ count: 1, outstanding: 100 });
    expect(rows.reduce((s, r) => s + r.count, 0)).toBe(1);
    expect(sql).toContain("i.archived_at IS NULL");
    expect(sql).toContain("NOT IN (''void'', ''cancelled'', ''canceled'')");
    expect(sql).not.toMatch(/UPDATE[^;]*0001771/);
  });
});

describe("invoice archive guard", () => {
  it("checks archived_at only when it changes, and only for void or cancelled", () => {
    expect(sql).toContain("OLD.archived_at IS DISTINCT FROM NEW.archived_at");
    expect(sql).toContain("BEFORE INSERT OR UPDATE OF archived_at");
    expect(sql).toContain("Only a void or cancelled invoice can be archived");
    expect(sql).toContain("quote_options_move_back");
    expect(rollback.split("\n")[0]).toBe("-- MANUAL ROLLBACK - DO NOT RUN AS MIGRATION");
  });
});

describe("archived banners and the public page", () => {
  it("shows a staff banner with restore, and a friendly public page", () => {
    render(<ArchivedQuoteBanner quote={{ archived_at: "2026-11-14T10:00:00Z", archive_reason: "Auto-archived: 45 days no activity" }} onUnarchive={() => {}} />);
    expect(screen.getByTestId("archived-banner").textContent).toContain("Archived");
    expect(screen.getByRole("button", { name: "Unarchive" })).toBeTruthy();
    render(<ArchivedRecordBanner at="2026-11-14T10:00:00Z" reason="No reply" onRestore={() => {}} />);
    expect(screen.getByTestId("archived-record-banner").textContent).toContain("No reply");
    render(<PublicUnavailable />);
    expect(screen.getByTestId("public-unavailable").textContent).toContain("no longer available");
    expect(screen.getByTestId("public-unavailable").textContent).toContain("contact us");
    expect(sql).toContain("jsonb_build_object('unavailable', true)");
    expect(sql).toContain("get_customer_invoices_public");
    expect(sql).toContain("get_deposit_invoice_by_quote_token");
  });
});
