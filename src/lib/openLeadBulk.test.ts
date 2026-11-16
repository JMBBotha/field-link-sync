import { describe, expect, it } from "vitest";
import { bulkSendLine, markSentSplit, sendableLines } from "@/lib/openLeadBulk";
import { shouldAutoArchiveOpenLead } from "@/lib/openLeads";
import type { OpenLeadRow } from "@/lib/yardView";

const NOW = new Date("2026-11-16T08:00:00+02:00");
const row = (over: Partial<OpenLeadRow> & { id: string }): OpenLeadRow => ({
  kind: "quote", customer: "Client", stage: "Quoting", typeLabel: null, quoteRef: "Q-1", amountLabel: "R10",
  href: "/admin/estimates/q", quoteId: "q", leadId: null, customerId: "c", docStatus: "draft", ownerId: null,
  lastActivityAt: "2026-11-01", stale: false, ...over,
});

describe("bulk open leads", () => {
  it("marks only drafts and skips the rest", () => {
    const split = markSentSplit([row({ id: "a" }), row({ id: "b", docStatus: "sent", stage: "Waiting on customer" })]);
    expect(split.drafts.map((r) => r.id)).toEqual(["a"]);
    expect(split.skipped.map((r) => r.id)).toEqual(["b"]);
  });

  it("flags a quote with no contact and a lead with no quote", () => {
    const bare = bulkSendLine(row({ id: "lead:1", kind: "lead", quoteId: null, docStatus: "pending", stage: "New lead" }));
    const quiet = bulkSendLine(row({ id: "q" }), { email: "", phone: "" });
    const phoneOnly = bulkSendLine(row({ id: "p" }), { phone: "0820000000" });
    const ready = bulkSendLine(row({ id: "ok" }), { email: "a@b.co", phone: "082" });
    expect(bare.block).toBe("No quote to send");
    expect(quiet.block).toBe("No email or phone on file");
    expect(phoneOnly.block).toBe("No email — sending uses email");
    expect(sendableLines([bare, quiet, phoneOnly, ready]).map((l) => l.id)).toEqual(["ok"]);
  });
});

describe("auto-archive rule", () => {
  it("archives a stale draft and a pending lead, and leaves accepted, invoiced, and fresh rows", () => {
    const old = "2026-08-01T08:00:00+02:00";
    const fresh = "2026-11-01T08:00:00+02:00";
    expect(shouldAutoArchiveOpenLead({ kind: "quote", status: "draft", lastActivity: old, now: NOW })).toBe(true);
    expect(shouldAutoArchiveOpenLead({ kind: "quote", status: "sent", lastActivity: old, now: NOW })).toBe(true);
    expect(shouldAutoArchiveOpenLead({ kind: "lead", status: "pending", lastActivity: old, now: NOW })).toBe(true);
    expect(shouldAutoArchiveOpenLead({ kind: "quote", status: "accepted", acceptedWithLiveJob: true, lastActivity: old, now: NOW })).toBe(false);
    expect(shouldAutoArchiveOpenLead({ kind: "quote", status: "draft", invoiced: true, lastActivity: old, now: NOW })).toBe(false);
    expect(shouldAutoArchiveOpenLead({ kind: "quote", status: "draft", archived: true, lastActivity: old, now: NOW })).toBe(false);
    expect(shouldAutoArchiveOpenLead({ kind: "quote", status: "draft", lastActivity: fresh, now: NOW })).toBe(false);
    expect(shouldAutoArchiveOpenLead({ kind: "lead", status: "pending", hasQuote: true, lastActivity: old, now: NOW })).toBe(false);
    expect(shouldAutoArchiveOpenLead({ kind: "quote", status: "declined", lastActivity: old, now: NOW })).toBe(false);
  });
});
