import { describe, it, expect, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import {
  parseQuoteParams, parseInvoiceParams, filterQuoteDocs, filterInvoices, clearParams, inPeriod, TILE_LINKS,
  PENDING_QUOTES_FILTER, OVERDUE_INVOICES_FILTER, REVENUE_TODAY_FILTER,
} from "@/lib/drilldown";

const NOW = new Date("2026-09-28T10:00:00Z");
const q = (status: string, created_at = "2026-09-20T10:00:00Z", kind: "estimate" | "proposal" = "estimate") => ({ kind, status, created_at });
const docs = [q("draft"), q("draft"), q("draft", undefined, "proposal"), q("sent"), q("viewed"), q("accepted"), q("accepted", "2026-04-01T00:00:00Z"), q("declined"), q("rejected"), q("superseded")];
const inv = (status: string, issue_date = "2026-09-01", paid_date: string | null = null) => ({ status, issue_date, paid_date });
const invs = [inv("overdue"), inv("overdue"), inv("sent"), inv("draft"), inv("paid", "2026-09-01", "2026-09-28"), inv("paid", "2026-09-01", "2026-09-27")];
const params = (href: string) => new URL(href, "http://x").searchParams;

describe("URL parsing", () => {
  it("comma status, type, period", () => {
    expect(parseQuoteParams(params("/?status=sent,Viewed&type=estimate&period=30d"))).toEqual({ status: ["sent", "viewed"], type: "estimate", period: "30d" });
    expect(parseQuoteParams(params("/?type=bogus&period=nope")).period).toBeNull();
    expect(parseQuoteParams(params("/?period=2026-09")).period).toBe("2026-09");
    expect(parseInvoiceParams(params("/?state=unpaid&period=today"))).toEqual({ state: "unpaid", period: "today" });
  });
  it("period today uses the Johannesburg day", () => {
    expect(inPeriod("2026-09-27T22:30:00Z", "today", NOW)).toBe(true); // 00:30 SAST on the 28th
    expect(inPeriod("2026-09-27T21:30:00Z", "today", NOW)).toBe(false);
    expect(inPeriod("2026-09-10T00:00:00Z", "2026-09", NOW)).toBe(true);
    expect(inPeriod("2026-06-01T00:00:00Z", "90d", NOW)).toBe(false);
  });
});

describe("tile count == list rows for its link", () => {
  it("Pending Quotes", () => {
    const tile = filterQuoteDocs(docs.filter((d) => d.kind === "estimate"), PENDING_QUOTES_FILTER).length;
    expect(filterQuoteDocs(docs, parseQuoteParams(params(TILE_LINKS.pendingQuotes)), NOW)).toHaveLength(tile);
    expect(tile).toBe(2);
  });
  it("Open quotes / won / lost (90d)", () => {
    expect(filterQuoteDocs(docs, parseQuoteParams(params(TILE_LINKS.openQuotesValue)), NOW)).toHaveLength(4);
    expect(filterQuoteDocs(docs, parseQuoteParams(params(TILE_LINKS.quotesWon90)), NOW)).toHaveLength(1);
    expect(filterQuoteDocs(docs, parseQuoteParams(params(TILE_LINKS.quotesLost90)), NOW)).toHaveLength(2);
  });
  it("Overdue invoices and Revenue today", () => {
    const tile = filterInvoices(invs, OVERDUE_INVOICES_FILTER).length;
    expect(filterInvoices(invs, parseInvoiceParams(params(TILE_LINKS.overdueInvoices)), NOW)).toHaveLength(tile);
    const rev = filterInvoices(invs, REVENUE_TODAY_FILTER, NOW);
    expect(filterInvoices(invs, parseInvoiceParams(params(TILE_LINKS.revenueToday)), NOW)).toEqual(rev);
    expect(rev).toHaveLength(1);
  });
  it("Outstanding = unpaid = sent + overdue", () => {
    expect(filterInvoices(invs, { state: "unpaid" })).toHaveLength(3);
  });
});

describe("chips clear params", () => {
  it("clears one or all", () => {
    const p = params("/?status=draft&type=estimate&period=7d&money=due");
    expect(clearParams(p, ["type"]).toString()).toBe("status=draft&period=7d&money=due");
    expect(clearParams(p, ["status", "type", "period"]).toString()).toBe("money=due");
  });
});
