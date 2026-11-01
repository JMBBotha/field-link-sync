import { describe, it, expect } from "vitest";
import { timelineSteps, type RecordData } from "@/components/sales/RecordSheet";
import { channelLabel } from "@/components/documents/MarkSentManually";

const base: RecordData = { kind: "quote", id: "q1", number: "Q-DEMO-1", client: "Demo Client A", total: 1000, status: "draft", created_at: "2026-10-01T08:00:00Z",
  sent_at: null, sent_channel: null, sent_method: null, viewed_at: null, accepted_at: null, declined_at: null, invoices: [] };

describe("record timeline (real fields only)", () => {
  it("says Not sent / Not viewed yet with no dates", () => {
    const s = timelineSteps(base);
    expect(s.find((x) => x.k === "sent")).toMatchObject({ when: null, empty: "Not sent" });
    expect(s.find((x) => x.k === "viewed")).toMatchObject({ when: null, empty: "Not viewed yet" });
    expect(s.find((x) => x.k === "accepted")?.empty).toBe("Not accepted yet");
  });
  it("shows the Mark as sent channel", () => {
    const s = timelineSteps({ ...base, status: "sent", sent_at: "2026-10-02T08:00:00Z", sent_method: "manual", sent_channel: "pdf_downloaded" });
    expect(s.find((x) => x.k === "sent")?.label).toContain("PDF downloaded");
  });
  it("shows declined instead of accepted, and part-paid balance", () => {
    expect(timelineSteps({ ...base, status: "declined", declined_at: "2026-10-03T08:00:00Z" }).some((x) => x.k === "declined")).toBe(true);
    const s = timelineSteps({ ...base, kind: "invoice", invoices: [{ id: "i1", invoice_number: "INV-1", status: "partially_paid", grand_total: 1000, paid: 400, paid_date: null, created_at: null, sent_at: null, sent_channel: null, sent_method: null }] });
    expect(s.find((x) => x.k === "paid-i1")?.label).toContain("balance R 600");
  });
  it("labels every channel, including the old Handed over", () => {
    expect(["email", "pdf_downloaded", "whatsapp", "in_person", "other", "handed_over"].map(channelLabel)).toEqual(["Email", "PDF downloaded", "WhatsApp", "In person", "Other", "Handed over"]);
  });
});
