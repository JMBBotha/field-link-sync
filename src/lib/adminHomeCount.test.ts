import { describe, expect, it } from "vitest";
import {
  MASSAIR_CT_ID, MASSAIR_IND_ID, TEST_HVAC_ID, countAdminHome, inSignedInCompany, jhbMonth, monthChangePct, thenInOrderDetail, waitingRule,
  type HomeInvoice, type HomeJob, type HomePayment, type HomeQuote,
} from "./adminHomeCount";

const CT = MASSAIR_CT_ID;
const NOW = new Date("2026-11-06T10:00:00+02:00");

function quote(over: Partial<HomeQuote> & { id: string }): HomeQuote {
  return {
    company_id: CT, status: "sent", total: 1000, created_at: "2026-10-01T08:00:00+02:00",
    quote_number: over.id, customer_name: "Client", ...over,
  };
}

describe("admin home company scope", () => {
  it("keeps Test HVAC out, and only the signed-in company in", () => {
    expect(inSignedInCompany(CT, CT)).toBe(true);
    expect(inSignedInCompany(MASSAIR_IND_ID, CT)).toBe(false);
    expect(inSignedInCompany(TEST_HVAC_ID, CT)).toBe(false);
    expect(inSignedInCompany(TEST_HVAC_ID, TEST_HVAC_ID)).toBe(false);
    expect(inSignedInCompany(null, CT)).toBe(false);
  });

  it("a newer other-company invoice does not leak into Massair CT totals", () => {
    const invoices: HomeInvoice[] = [
      { id: "ct", company_id: CT, status: "draft", grand_total: 18400, invoice_number: "INV-CT", customer_name: "CT client", created_at: "2026-11-01T08:00:00+02:00", call_out_excl_vat: 680 },
      { id: "ind", company_id: MASSAIR_IND_ID, status: "draft", grand_total: 90000, invoice_number: "INV-IND", customer_name: "Ind client", created_at: "2026-11-06T18:00:00+02:00" },
      { id: "hvac", company_id: TEST_HVAC_ID, status: "draft", grand_total: 70000, invoice_number: "INV-HVAC", customer_name: "Test HVAC", created_at: "2026-11-06T19:00:00+02:00" },
    ];
    const c = countAdminHome({ companyId: CT, now: NOW, invoices });
    expect(c.waiting.total).toBe(18400);
    expect(c.waiting.count).toBe(1);
    expect(c.waiting.lines.map((l) => l.id)).toEqual(["ct"]);
    expect(c.waiting.rule).toBe(waitingRule(1));
    expect(c.waiting.rule).toContain("The call-out fee is never deducted.");
    expect(c.money.total).toBe(18400);
  });
});

describe("admin home counting", () => {
  const invoices: HomeInvoice[] = [
    { id: "a", company_id: CT, status: "draft", grand_total: 18400, customer_name: "Client 5", invoice_number: "INV-D-021", call_out_excl_vat: 680 },
    { id: "b", company_id: CT, status: "draft", grand_total: 15870, customer_name: "Client 8", invoice_number: "INV-D-022" },
    { id: "c", company_id: CT, status: "draft", grand_total: 8225.5, customer_name: "Client 2", invoice_number: "INV-D-023" },
    { id: "emailed", company_id: CT, status: "draft", grand_total: 999, sent_at: "2026-11-02T08:00:00+02:00", notes: "DEPOSIT — 50%", customer_name: "Emailed", invoice_number: "INV-EMAIL" },
    { id: "dep", company_id: CT, status: "sent", grand_total: 10000, sent_at: "2026-11-02T08:00:00+02:00", notes: "DEPOSIT — 50%", customer_name: "Dep", invoice_number: "INV-DEP" },
    { id: "fin", company_id: CT, status: "partially_paid", grand_total: 5000, sent_at: "2026-10-02T08:00:00+02:00", notes: "Balance", customer_name: "Fin", invoice_number: "INV-FIN" },
    { id: "paid", company_id: CT, status: "paid", grand_total: 2000, sent_at: "2026-11-01T08:00:00+02:00", customer_name: "Paid", invoice_number: "INV-PAID" },
    { id: "arch", company_id: CT, status: "draft", grand_total: 1111, archived_at: "2026-11-01", invoice_number: "INV-ARCH" },
    { id: "voided", company_id: CT, status: "cancelled", grand_total: 2222, invoice_number: "INV-VOID" },
    { id: "ind", company_id: MASSAIR_IND_ID, status: "draft", grand_total: 50000, created_at: "2026-11-06T20:00:00+02:00", invoice_number: "INV-IND" },
  ];
  const payments: HomePayment[] = [
    { id: "p-fin", invoice_id: "fin", company_id: CT, amount: 1000, status: "paid", payment_date: "2026-11-03" },
    { id: "p-pending", invoice_id: "fin", company_id: CT, amount: 500, status: "pending", payment_date: "2026-11-03" },
    { id: "p-paid", invoice_id: "paid", company_id: CT, amount: 2000, status: "completed", payment_date: "2026-11-04" },
    { id: "p-old", invoice_id: "paid", amount: 100, status: "paid", payment_date: "2026-10-15" },
    { id: "p-ind", invoice_id: "dep", company_id: MASSAIR_IND_ID, amount: 4000, status: "paid", payment_date: "2026-11-04" },
  ];
  const credits = [
    { invoice_id: "fin", total: 250, status: "issued" },
    { invoice_id: "fin", total: 999, status: "void" },
  ];
  const jobs: HomeJob[] = [
    { id: "s1", company_id: CT, job_type: "repair", title: "Not cooling", status: "scheduled", scheduled_for: "2026-11-03T08:00:00+02:00", customer_name: "A" },
    { id: "s2", company_id: CT, job_type: "service", title: "Service", status: "completed", completed_at: "2026-11-04T08:00:00+02:00", customer_name: "B" },
    { id: "i1", company_id: CT, job_type: "installation", title: "Install", status: "scheduled", scheduled_for: "2026-11-05T08:00:00+02:00", customer_name: "C" },
    { id: "i2", company_id: CT, job_type: "quote", title: "Site visit", status: "scheduled", scheduled_for: "2026-11-02T08:00:00+02:00", customer_name: "D" },
    { id: "m1", company_id: CT, job_type: "move", title: "Relocate lounge", status: "scheduled", scheduled_for: "2026-11-06T08:00:00+02:00", customer_name: "E" },
    { id: "old", company_id: CT, job_type: "service", title: "Done late", status: "completed", scheduled_for: "2026-10-20T08:00:00+02:00", completed_at: "2026-11-02T08:00:00+02:00", customer_name: "F" },
    { id: "cx", company_id: CT, job_type: "service", title: "Cancelled", status: "cancelled", scheduled_for: "2026-11-02T08:00:00+02:00", customer_name: "G" },
    { id: "ind", company_id: MASSAIR_IND_ID, job_type: "installation", title: "Ind install", status: "scheduled", scheduled_for: "2026-11-06T09:00:00+02:00", customer_name: "H" },
    { id: "hvac", company_id: TEST_HVAC_ID, job_type: "service", title: "Hidden", status: "scheduled", scheduled_for: "2026-11-06T09:00:00+02:00", customer_name: "I" },
    { id: "odd", company_id: CT, job_type: null, title: "Odd job", status: "scheduled", created_at: "2026-11-01T08:00:00+02:00", customer_name: "J" },
  ];
  const quotes: HomeQuote[] = [
    quote({ id: "q1", status: "accepted", total: 14000, accepted_at: "2026-11-02T08:00:00+02:00", quote_number: "Q-D-001", call_out_excl_vat: 680 }),
    quote({ id: "q2", status: "accepted", total: 5000, accepted_at: "2026-11-03T08:00:00+02:00", option_group_id: "g1", quote_number: "Q-D-002" }),
    quote({ id: "q3", status: "accepted", total: 8000, accepted_at: "2026-11-03T08:00:00+02:00", option_group_id: "g1", quote_number: "Q-D-003" }),
    quote({ id: "q4", status: "accepted", total: 4000, accepted_at: "2026-10-15T08:00:00+02:00", quote_number: "Q-D-004" }),
    quote({ id: "q5", status: "viewed", total: 22000, sent_at: "2026-11-02T08:00:00+02:00", viewed_at: "2026-11-05T14:40:00+02:00", quote_number: "Q-D-005" }),
    quote({ id: "q6", status: "sent", total: 1000, sent_at: "2026-11-01T08:00:00+02:00", quote_number: "Q-D-006" }),
    quote({ id: "q7", status: "draft", total: 3000, quote_number: "Q-D-007" }),
    quote({ id: "q8", status: "accepted", total: 31000, accepted_at: "2026-11-01T08:00:00+02:00", quote_number: "Q-D-008" }),
    quote({ id: "qedge", status: "accepted", total: 100, accepted_at: "2026-10-31T22:30:00Z", quote_number: "Q-EDGE" }),
    quote({ id: "qlost", status: "declined", total: 50, accepted_at: "2026-11-04T08:00:00+02:00", declined_at: "2026-11-05T08:00:00+02:00", quote_number: "Q-LOST" }),
    quote({ id: "qind", company_id: MASSAIR_IND_ID, status: "accepted", total: 99999, accepted_at: "2026-11-06T08:00:00+02:00", created_at: "2026-11-06T08:00:00+02:00", quote_number: "Q-IND" }),
    quote({ id: "qhvac", company_id: TEST_HVAC_ID, status: "viewed", total: 88888, quote_number: "Q-HVAC" }),
  ];

  const counts = () => countAdminHome({
    companyId: CT, now: NOW, invoices, payments, credits, jobs, quotes,
    quoteJobs: [{ quote_id: "q8", status: "scheduled", created_at: "2026-11-02T08:00:00+02:00" }],
  });

  it("counts unsent drafts at full incl-VAT total and never deducts the call-out", () => {
    const c = counts();
    expect(c.waiting.total).toBe(42495.5);
    expect(c.waiting.count).toBe(3);
    expect(c.waiting.rule).toBe("3 draft invoices that have not been emailed yet, amounts incl. VAT. The call-out fee is never deducted.");
    expect(c.waiting.lines.map((l) => l.label)).toEqual([
      "INV-D-021 · Client 5",
      "INV-D-022 · Client 8",
      "INV-D-023 · Client 2",
    ]);
    expect(c.waiting.actionLabel).toBe("Review & send");
    expect(c.waiting.lines[0].href).toBe("/admin/invoices/a");
  });

  it("splits deposit due, final due and paid this month, and ignores another company's payment", () => {
    const c = counts();
    // Emailed draft (999) + untouched deposit (Ind payment of 4000 ignored).
    expect(c.deposit.total).toBe(10999);
    expect(c.deposit.lines.map((l) => l.id).sort()).toEqual(["dep", "emailed"]);
    // 5000 − 1000 settled − 250 issued credit. Pending payment and void credit do not count.
    expect(c.finalDue.total).toBe(3750);
    expect(c.finalDue.lines.map((l) => l.id)).toEqual(["fin"]);
    // November settled payments only: 1000 on the final + 2000 on the paid invoice. October payment stays out.
    expect(c.paid.total).toBe(3000);
    expect(c.owed.total).toBe(c.deposit.total + c.finalDue.total);
    expect(c.money.total).toBe(c.waiting.total + c.deposit.total + c.finalDue.total + c.paid.total);
    expect(c.owed.lines.some((l) => l.id === "a" || l.id === "ind")).toBe(false);
  });

  it("counts this month's jobs by kind and leaves other companies out", () => {
    const c = counts();
    const n = (key: string) => c.workSlices.find((s) => s.key === key)?.figure.count ?? 0;
    expect(n("service")).toBe(2);
    expect(n("installation")).toBe(2);
    expect(n("move")).toBe(1);
    expect(n("other")).toBe(1);
    expect(c.work.count).toBe(6);
    expect(c.work.lines.some((l) => l.id.includes("ind") || l.id.includes("hvac") || l.id.includes("old") || l.id.includes("cx"))).toBe(false);
    expect(c.workSlices.find((s) => s.key === "installation")?.figure.lines.map((l) => l.href)).toContain("/admin/jobs/i2");
  });

  it("counts accepted and open quotes once per option group, in the Johannesburg month", () => {
    const c = counts();
    // 14000 + option group 8000 (not 5000 as well) + booked 31000 + SAST edge 100 + declined-but-accepted 50.
    expect(c.accepted.total).toBe(53150);
    expect(c.accepted.lines.map((l) => l.id).sort()).toEqual(["q1", "q3", "q8", "qedge", "qlost"].sort());
    expect(c.previousAccepted).toBe(4000);
    expect(monthChangePct(c.accepted.total, c.previousAccepted)).toBe(1229);
    expect(c.open.total).toBe(23000);
    expect(c.open.lines.map((l) => l.id).sort()).toEqual(["q5", "q6"]);
    expect(c.draftsNotSent).toBe(1);
    expect(c.accepted.rule).toContain("The call-out fee is never deducted.");
    expect(jhbMonth("2026-10-31T22:30:00Z")).toBe("2026-11");
  });

  it("describes an expanded row from sent and last-viewed, without inventing a view count", () => {
    expect(thenInOrderDetail({ sent_at: "2026-11-02T08:00:00+02:00", viewed_at: "2026-11-05T14:40:00+02:00" }, 22600))
      .toBe("Sent 2 Nov · last viewed 5 Nov · 14:40 · R22.6k incl. VAT");
  });
});
