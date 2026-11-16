import { describe, expect, it } from "vitest";
import { MASSAIR_CT_ID, MASSAIR_IND_ID, TEST_HVAC_ID, type HomeInvoice, type HomeQuote } from "@/lib/adminHomeCount";
import { bankBalanceStaleHint, type Allocation, type BankAccount, type BankBalance, type Commitment, type Receipt } from "@/lib/cashHealth";
import { canArchiveOpenLead, OPEN_LEAD_STALE_DAYS } from "@/lib/openLeads";
import {
  buildYardHome, countJobPeriods, countSales, jhbGreetingTitle, jhbRanges, paymentWhen, summarisePaymentDates, yardStage,
  type YardJob, type YardLead,
} from "@/lib/yardView";

const CT = MASSAIR_CT_ID;
const NOW = new Date("2026-11-07T08:00:00+02:00");
const JOHAN_ADMIN = "1e795a9b-f8bd-4af5-8f28-5e0426101daa";
const JOHAN_SALES = "420c7731-e8a4-4355-80ca-51c684b42a2c";

function job(over: Partial<YardJob> & { id: string }): YardJob {
  return { company_id: CT, status: "scheduled", title: "Install", job_type: "installation", customer_name: "Client", ...over };
}

function inv(over: Partial<HomeInvoice> & { id: string }): HomeInvoice {
  return {
    company_id: CT, status: "sent", sent_at: "2026-11-01T08:00:00+02:00", grand_total: 1000,
    customer_name: "Client", invoice_number: over.id, issue_date: "2026-01-01", ...over,
  };
}

function quote(over: Partial<HomeQuote> & { id: string }): HomeQuote {
  return { company_id: CT, status: "draft", total: 1000, created_at: "2026-11-01T08:00:00+02:00", customer_name: "Client", quote_number: over.id, ...over };
}

function lead(over: Partial<YardLead> & { id: string }): YardLead {
  return { company_id: CT, status: "pending", customer_name: "Lead", primary_intent: "sales", ...over };
}

describe("yard stages", () => {
  const today = "2026-11-07";

  it("maps booked, en route, on site and done today, and hides a zero stage's jobs", () => {
    const jobs = [
      job({ id: "yard", scheduled_for: "2026-11-07T06:00:00+02:00", created_by: JOHAN_ADMIN, assignee_name: "Hennie Matthee" }),
      job({ id: "road", scheduled_for: "2026-11-07T07:00:00+02:00", status: "dispatched", en_route_at: "2026-11-07T07:10:00+02:00", created_by: JOHAN_SALES }),
      job({ id: "site", scheduled_for: "2026-11-06T07:00:00+02:00", status: "in_progress", started_at: "2026-11-06T07:30:00+02:00" }),
      job({ id: "done", status: "completed", completed_at: "2026-11-07T09:00:00+02:00", scheduled_for: "2026-11-07T05:00:00+02:00" }),
      job({ id: "old", status: "completed", completed_at: "2026-11-06T09:00:00+02:00" }),
      job({ id: "cancel", status: "cancelled", scheduled_for: "2026-11-07T08:00:00+02:00" }),
      job({ id: "ind", company_id: MASSAIR_IND_ID, scheduled_for: "2026-11-07T08:00:00+02:00" }),
      job({ id: "hvac", company_id: TEST_HVAC_ID, scheduled_for: "2026-11-07T08:00:00+02:00" }),
      job({ id: "later", scheduled_for: "2026-11-09T08:00:00+02:00" }),
      job({ id: "nodate", status: "completed" }),
    ];
    expect(yardStage(jobs[0], CT, today)).toBe("waiting");
    expect(yardStage(jobs[1], CT, today)).toBe("en_route");
    expect(yardStage(jobs[2], CT, today)).toBe("on_site");
    expect(yardStage(jobs[3], CT, today)).toBe("done");
    expect(yardStage(jobs[4], CT, today)).toBeNull();
    expect(yardStage(jobs[5], CT, today)).toBeNull();
    expect(yardStage(jobs[6], CT, today)).toBeNull();
    expect(yardStage(jobs[7], CT, today)).toBeNull();
    expect(yardStage(jobs[7], TEST_HVAC_ID, today)).toBeNull();
    expect(yardStage(jobs[8], CT, today)).toBeNull();
    expect(yardStage(jobs[9], CT, today)).toBeNull();

    const model = buildYardHome({ companyId: CT, now: NOW, jobs, presence: [{ job_id: "yard", arrived_at: "2026-11-07T08:00:00+02:00" }] });
    const byKey = Object.fromEntries(model.stages.map((stage) => [stage.key, stage]));
    expect(byKey.waiting.count).toBe(0);
    expect(byKey.waiting.jobs).toEqual([]);
    expect(byKey.en_route.count).toBe(1);
    expect(byKey.en_route.jobs[0]).toMatchObject({ customer: "Client", assignee: "Unassigned", type: "Installation" });
    expect(byKey.on_site.jobs.map((row) => row.id).sort()).toEqual(["site", "yard"]);
    expect(byKey.on_site.jobs.find((row) => row.id === "yard")).toMatchObject({ assignee: "Hennie Matthee", status: "On site · scheduled" });
    expect(byKey.done.count).toBe(1);
    expect(byKey.done.jobs[0].id).toBe("done");
  });

  it("keeps a scheduled job in the yard until presence or status moves it", () => {
    const waiting = job({ id: "a", scheduled_for: "2026-11-07T06:00:00+02:00" });
    expect(yardStage(waiting, CT, "2026-11-07", { job_id: "a", en_route_at: "2026-11-07T06:30:00+02:00" })).toBe("en_route");
    expect(yardStage(waiting, CT, "2026-11-07", { job_id: "a", en_route_at: "2026-11-07T06:30:00+02:00", arrived_at: "2026-11-07T07:00:00+02:00", left_at: "2026-11-07T09:00:00+02:00" })).toBe("waiting");
  });
});

describe("job periods", () => {
  it("uses Johannesburg today, Monday–Sunday week, and the calendar month", () => {
    expect(jhbRanges(NOW)).toEqual({ today: "2026-11-07", weekStart: "2026-11-02", weekEnd: "2026-11-08", month: "2026-11" });
    expect(jhbRanges(new Date("2026-11-07T22:30:00Z")).today).toBe("2026-11-08");
    const jobs = [
      job({ id: "today", scheduled_for: "2026-11-07T08:00:00+02:00" }),
      job({ id: "mon", scheduled_for: "2026-11-02T08:00:00+02:00" }),
      job({ id: "next", scheduled_for: "2026-11-09T08:00:00+02:00" }),
      job({ id: "oct", scheduled_for: "2026-10-31T08:00:00+02:00" }),
      job({ id: "late", status: "cancelled", scheduled_for: "2026-11-07T08:00:00+02:00" }),
      job({ id: "ind", company_id: MASSAIR_IND_ID, scheduled_for: "2026-11-07T08:00:00+02:00" }),
    ];
    expect(countJobPeriods(jobs, CT, NOW)).toEqual({ today: 1, week: 2, month: 3 });
  });
});

describe("money dates", () => {
  it("shows stored expected and due dates, and does not invent one from the issue date", () => {
    expect(paymentWhen(inv({ id: "a", notes: "DEPOSIT", issue_date: "2026-01-15" }), "deposit")).toEqual({ iso: null, tone: "none" });
    expect(paymentWhen(inv({ id: "b", notes: "DEPOSIT", expected_deposit_date: "2026-11-12" }), "deposit")).toEqual({ iso: "2026-11-12", tone: "expected" });
    expect(paymentWhen(inv({ id: "c", notes: "Final", due_date: "2026-11-20", due_date_source: "manual" }), "final")).toEqual({ iso: "2026-11-20", tone: "expected" });
    expect(paymentWhen(inv({ id: "d", notes: "Final", due_date: "2026-11-18", due_date_source: "terms" }), "final")).toEqual({ iso: "2026-11-18", tone: "due" });
    expect(paymentWhen(inv({ id: "e", notes: "Final", final_unscheduled: true, due_date: "2026-11-18", due_date_source: "terms" }), "final")).toEqual({ iso: null, tone: "completion" });
    expect(paymentWhen(inv({ id: "f", notes: "Final", expected_final_date: "2026-12-01", final_unscheduled: true }), "final")).toEqual({ iso: "2026-12-01", tone: "expected" });

    const model = buildYardHome({
      companyId: CT,
      now: NOW,
      invoices: [
        inv({ id: "d1", invoice_number: "DEP-1", notes: "DEPOSIT", grand_total: 28000, expected_deposit_date: "2026-11-12", customer_name: "A" }),
        inv({ id: "d2", invoice_number: "DEP-2", notes: "DEPOSIT", grand_total: 4000, expected_deposit_date: "2026-11-19", customer_name: "B" }),
        inv({ id: "d3", invoice_number: "DEP-3", notes: "DEPOSIT", grand_total: 500, customer_name: "C" }),
        inv({ id: "f1", invoice_number: "FIN-1", notes: "Balance", grand_total: 76700, expected_final_date: "2026-11-28", customer_name: "D" }),
        inv({ id: "ind", company_id: MASSAIR_IND_ID, notes: "DEPOSIT", grand_total: 90000, expected_deposit_date: "2026-11-01" }),
      ],
      bankState: "ready",
      bank: { accounts: [], balances: [] },
      booksState: "ready",
      books: { receipts: [], commitments: [], allocations: [] },
    });
    expect(model.deposits.amountLabel).toBe("R32 500");
    expect(model.deposits.dateLine).toBe("Next 12 Nov – 19 Nov · 1 with no date");
    expect(model.deposits.lines.map((line) => line.dateLabel)).toEqual(["Expected 12 Nov", "Expected 19 Nov", "Date not set"]);
    expect(model.deposits.lines[0].href).toBe("/admin/invoices/d1");
    expect(model.finals.dateLine).toBe("Expected 28 Nov");
    expect(model.finals.amountLabel).toBe("R76 700");
    expect(model.cash.amountLabel).toBeNull();
    expect(model.cash.dateLine).toBe("Not entered");
    expect(model.liabilities.amountLabel).toBe("R0");
    expect(model.liabilities.dateLine).toBe("Nothing still to buy");
  });

  it("summarises one date, a range, completion, and an empty set", () => {
    expect(summarisePaymentDates([])).toBe("Nothing due");
    expect(summarisePaymentDates([{ iso: "2026-11-12", tone: "expected" }])).toBe("Expected 12 Nov");
    expect(summarisePaymentDates([{ iso: "2026-11-18", tone: "due" }, { iso: "2026-12-02", tone: "due" }])).toBe("Next 18 Nov – 2 Dec");
    expect(summarisePaymentDates([{ iso: null, tone: "completion" }, { iso: null, tone: "none" }])).toBe("Due on completion · 1 with no date");
    expect(summarisePaymentDates([{ iso: null, tone: "none" }])).toBe("Date not set");
  });

  it("reads cash-health balances and liability pay dates", () => {
    const accounts: BankAccount[] = [
      { id: "a", label: "Current", account_ref: null, include: true, sort: 1 },
      { id: "b", label: "Savings", account_ref: null, include: true, sort: 2 },
    ];
    const balances: BankBalance[] = [
      { id: "ba", account_id: "a", balance: 150000, as_of: "2026-11-03", created_at: "2026-11-03T08:00:00Z" },
      { id: "bb", account_id: "b", balance: 36400, as_of: "2026-11-06", created_at: "2026-11-06T08:00:00Z" },
    ];
    const receipts: Receipt[] = [{
      id: "r", source: "field_lynk", invoice_id: "inv", quote_id: null, ref: "INV-1", client: "Client",
      part: "deposit", amount_incl: 5000, vat_incl: 0, expected_date: "2026-11-01", leeway_days: 0, confidence: 100,
      status: "received", received_date: "2026-11-01", note: null,
    }];
    const commitments: Commitment[] = [
      { id: "c1", source_key: null, invoice_id: "inv", quote_id: null, job_id: "job-1", project: "INV-1 Client", item: "Outdoor unit", kind: "unit", qty: 1, supplier: null, unit_cost_excl: 1000, vat_rate: 15, status: "needed", pay_date: "2026-11-20", note: null },
      { id: "c2", source_key: null, invoice_id: "inv", quote_id: null, job_id: "job-1", project: "INV-1 Client", item: "Bracket", kind: "material", qty: 1, supplier: null, unit_cost_excl: 200, vat_rate: 15, status: "needed", pay_date: null, note: null },
    ];
    const allocations: Allocation[] = [];
    const model = buildYardHome({
      companyId: CT, now: NOW, bankState: "ready", bank: { accounts, balances }, booksState: "ready", books: { receipts, commitments, allocations },
    });
    expect(model.cash.amountLabel).toBe("R186 400");
    expect(model.cash.dateLine).toBe("As at 3 Nov – 6 Nov");
    expect(model.cash.staleHint).toBeNull();
    expect(model.cash.lines.map((line) => line.dateLabel)).toEqual(["Typed by a person on 3 Nov", "Typed by a person on 6 Nov"]);
    expect(model.cash.href).toBe("/admin/cash-health");
    expect(model.liabilities.amountLabel).toBe("R1 380");
    expect(model.liabilities.dateLine).toBe("Pay 20 Nov · 1 with no date");
    expect(model.liabilities.lines[0]).toMatchObject({ href: "/admin/jobs/job-1", dateLabel: "Pay 20 Nov" });
    expect(model.liabilities.lines[1].dateLabel).toBe("No pay date");
  });

  it("keeps As at on Cash on hand and adds the Monday warning once the snapshot is older than 7 days", () => {
    const accounts: BankAccount[] = [
      { id: "a", label: "FNB Business", account_ref: "…563591", include: true, sort: 1 },
      { id: "b", label: "Savings", account_ref: null, include: true, sort: 2 },
    ];
    const balances: BankBalance[] = [
      { id: "old", account_id: "a", balance: 347388, as_of: "2026-10-01", created_at: "2026-10-01T08:00:00Z", source: "walda" },
      { id: "fresh", account_id: "b", balance: 100, as_of: "2026-11-07", created_at: "2026-11-07T08:00:00Z", source: "manual" },
    ];
    const model = buildYardHome({ companyId: CT, now: NOW, bankState: "ready", bank: { accounts, balances } });
    expect(model.cash.dateLine).toBe("As at 1 Oct – 7 Nov");
    expect(model.cash.staleHint).toBe(bankBalanceStaleHint("2026-10-01", NOW));
    expect(model.cash.staleHint).toBe("Bank balance is from 2026-10-01. Update it (Mondays).");
    expect(model.cash.lines.map((line) => line.dateLabel)).toEqual(["Checked by WALDA on 1 Oct", "Typed by a person on 7 Nov"]);
    const fresh = buildYardHome({
      companyId: CT, now: NOW, bankState: "ready",
      bank: { accounts: [accounts[0]], balances: [{ id: "today", account_id: "a", balance: 10, as_of: "2026-11-07", created_at: "2026-11-07T08:00:00Z", source: "walda" }] },
    });
    expect(fresh.cash.dateLine).toBe("As at 7 Nov");
    expect(fresh.cash.staleHint).toBeNull();
  });
});

describe("sales strip", () => {
  it("maps new, quoting, waiting and booked, and keeps other companies out", () => {
    const sales = countSales({
      companyId: CT,
      now: NOW,
      leads: [
        lead({ id: "n1" }),
        lead({ id: "svc", primary_intent: "service" }),
        lead({ id: "gone", deleted_at: "2026-11-01" }),
        lead({ id: "ind", company_id: MASSAIR_IND_ID }),
        lead({ id: "quoted" }),
      ],
      quotes: [
        quote({ id: "q-draft", lead_id: "quoted", status: "draft" }),
        quote({ id: "q-sent", status: "sent", sent_at: "2026-11-02" }),
        quote({ id: "q-view", status: "viewed", viewed_at: "2026-11-03" }),
        quote({ id: "q-acc", status: "accepted", accepted_at: "2026-11-04" }),
        quote({ id: "q-book", status: "accepted", accepted_at: "2026-11-04" }),
        quote({ id: "q-ind", company_id: MASSAIR_IND_ID, status: "sent" }),
        quote({ id: "q-svc", lead_id: "svc-lead", status: "draft" }),
      ],
      leadIntent: { "svc-lead": "service" },
      quoteJobs: [
        { quote_id: "q-book", status: "scheduled", company_id: CT },
        { quote_id: "q-acc", status: "cancelled", company_id: CT },
        { quote_id: "q-sent", status: "scheduled", company_id: MASSAIR_IND_ID },
      ],
    });
    expect(sales.boxes.map((box) => [box.key, box.count])).toEqual([
      ["new", 1],
      ["quoting", 1],
      ["waiting", 2],
      ["booked", 1],
    ]);
    expect(sales.openLeads).toBe(1 + 1 + 2 + 1);
    expect(sales.openLeadRows).toHaveLength(sales.openLeads);
    expect(sales.openLeadRows.map((row) => row.stage)).toEqual(["New lead", "Quoting", "Waiting on customer", "Waiting on customer", "Accepted"]);
    expect(sales.openLeadRows.some((row) => row.id === "quote:q-book")).toBe(false);
    expect(sales.openLeadRows.some((row) => row.id === "quote:q-svc" || row.id === "quote:q-ind" || row.id === "lead:svc")).toBe(false);
    expect(sales.openLeadRows.find((row) => row.stage === "Accepted")?.href).toBe("/admin/jobs?tab=pipeline");
    expect(sales.openLeadRows.find((row) => row.stage === "Quoting")?.href).toBe("/admin/estimates/q-draft");
    expect(sales.boxes[0].href).toBe("/admin/dispatch?inbox=1");
    expect(sales.boxes[2].href).toBe("/admin/quotes?status=sent,viewed&type=estimate");
  });

  it("drops invoiced quotes and leads, and keeps a void invoice, a history number, and an accepted quote with no invoice", () => {
    const sales = countSales({
      companyId: CT,
      now: NOW,
      leads: [
        lead({ id: "fresh" }),
        lead({ id: "billed" }),
        lead({ id: "old", created_at: "2026-09-01T08:00:00+02:00", last_activity_at: "2026-09-01T08:00:00+02:00" }),
        lead({ id: "parked", archived_at: "2026-10-01" }),
      ],
      quotes: [
        quote({ id: "q-live", status: "draft", quote_number: "0000086", customer_name: "CAPE ESTATES PAARL (Pty) Ltd", updated_at: "2026-11-02T08:00:00+02:00" }),
        quote({ id: "q-inv", status: "draft", customer_name: "Invoiced draft" }),
        quote({ id: "q-void", status: "draft", customer_name: "Void invoice" }),
        quote({ id: "q-leadbill", status: "sent", lead_id: "billed", sent_at: "2026-11-01" }),
        quote({ id: "q-acc", status: "accepted", accepted_at: "2026-11-04" }),
        quote({ id: "q-acc-inv", status: "accepted", accepted_at: "2026-10-01" }),
        quote({ id: "q-book", status: "accepted", accepted_at: "2026-11-04" }),
        quote({ id: "q-lost", status: "declined", declined_at: "2026-11-02" }),
        quote({ id: "q-arch", status: "draft", archived_at: "2026-10-01" }),
        quote({ id: "q-old", status: "draft", customer_name: "Old quote", created_at: "2026-08-01T08:00:00+02:00", updated_at: "2026-08-20T08:00:00+02:00" }),
        quote({ id: "q-ind", company_id: MASSAIR_IND_ID, status: "draft", quote_number: "IND-0000086" }),
      ],
      leadInvoices: [
        { id: "inv-1", quote_id: "q-inv", status: "sent" },
        { id: "inv-void", quote_id: "q-void", status: "void" },
        { id: "inv-lead", lead_id: "billed", status: "draft" },
        { id: "inv-dead", quote_id: "q-acc-inv", status: "cancelled" },
      ],
      quoteJobs: [
        { quote_id: "q-book", status: "scheduled", company_id: CT, invoice_id: "inv-book" },
        { quote_id: "q-acc", status: "cancelled", company_id: CT },
        { quote_id: "q-acc-inv", status: "cancelled", company_id: CT, invoice_id: "inv-job" },
      ],
    });
    const ids = sales.openLeadRows.map((row) => row.id);
    expect(ids).toContain("quote:q-live");
    expect(ids).toContain("quote:q-void");
    expect(ids).toContain("quote:q-acc");
    expect(ids).toContain("lead:fresh");
    expect(ids).toContain("lead:old");
    expect(ids).toContain("quote:q-old");
    expect(ids).not.toContain("quote:q-inv");
    expect(ids).not.toContain("quote:q-leadbill");
    expect(ids).not.toContain("lead:billed");
    expect(ids).not.toContain("quote:q-acc-inv");
    expect(ids).not.toContain("quote:q-book");
    expect(ids).not.toContain("quote:q-lost");
    expect(ids).not.toContain("quote:q-arch");
    expect(ids).not.toContain("quote:q-ind");
    expect(ids).not.toContain("lead:parked");
    expect(sales.boxes.find((box) => box.key === "booked")?.count).toBe(1);
    expect(sales.boxes.find((box) => box.key === "quoting")?.count).toBe(3);
    expect(sales.openLeadRows.find((row) => row.id === "quote:q-old")?.stale).toBe(true);
    expect(sales.openLeadRows.find((row) => row.id === "lead:old")?.stale).toBe(true);
    expect(sales.openLeadRows.find((row) => row.id === "quote:q-live")?.stale).toBe(false);
    expect(OPEN_LEAD_STALE_DAYS).toBe(30);
  });

  it("drops a quote when its lead is closed or dismissed, and brings it back when the lead is restored", () => {
    const quotes = [
      quote({ id: "q-closed", status: "sent", lead_id: "gone", sent_at: "2026-11-02", customer_name: "Closed lead" }),
      quote({ id: "q-dismissed", status: "draft", lead_id: "away", customer_name: "Dismissed lead" }),
      quote({ id: "q-booked", status: "accepted", lead_id: "gone", accepted_at: "2026-11-04", customer_name: "Booked" }),
      quote({ id: "q-invoiced", status: "accepted", lead_id: "gone", accepted_at: "2026-11-04", customer_name: "Invoiced" }),
      quote({ id: "q-open", status: "sent", lead_id: "live", sent_at: "2026-11-02", customer_name: "Still open" }),
    ];
    const leadClosure = {
      gone: { closed_at: "2026-11-14", dismissed_at: null },
      away: { closed_at: null, dismissed_at: "2026-11-14" },
      live: { closed_at: null, dismissed_at: null },
    };
    const closed = countSales({
      companyId: CT,
      now: NOW,
      quotes,
      leadClosure,
      leadInvoices: [{ id: "inv-live", quote_id: "q-invoiced", status: "sent" }],
      quoteJobs: [{ quote_id: "q-booked", status: "scheduled", company_id: CT }],
    });
    const ids = closed.openLeadRows.map((row) => row.id);
    expect(ids).toContain("quote:q-open");
    expect(ids).not.toContain("quote:q-closed");
    expect(ids).not.toContain("quote:q-dismissed");
    expect(ids).not.toContain("quote:q-booked");
    expect(ids).not.toContain("quote:q-invoiced");
    expect(closed.boxes.find((box) => box.key === "booked")?.count).toBe(1);
    expect(closed.boxes.find((box) => box.key === "waiting")?.count).toBe(1);
    expect(closed.boxes.find((box) => box.key === "quoting")?.count).toBe(0);
    const restored = countSales({
      companyId: CT,
      now: NOW,
      quotes,
      leadClosure: { gone: { closed_at: null, dismissed_at: null }, away: { closed_at: null, dismissed_at: null } },
    });
    expect(restored.openLeadRows.map((row) => row.id)).toEqual(expect.arrayContaining(["quote:q-closed", "quote:q-dismissed"]));
  });
});

describe("who can archive", () => {
  const admin = { isAdmin: true, isSalesRep: false, userId: "admin" };
  const rep = { isAdmin: false, isSalesRep: true, userId: "rep" };
  it("lets an admin archive quotes and leads, and a salesperson only their own unquoted lead", () => {
    expect(canArchiveOpenLead({ kind: "quote", ownerId: "rep" }, admin)).toBe(true);
    expect(canArchiveOpenLead({ kind: "quote", ownerId: "rep" }, rep)).toBe(false);
    expect(canArchiveOpenLead({ kind: "lead", ownerId: "rep" }, rep)).toBe(true);
    expect(canArchiveOpenLead({ kind: "lead", ownerId: null }, rep)).toBe(true);
    expect(canArchiveOpenLead({ kind: "lead", ownerId: "other" }, rep)).toBe(false);
    expect(canArchiveOpenLead({ kind: "lead", ownerId: null }, { isAdmin: false, isSalesRep: false, userId: "x" })).toBe(false);
  });
});

describe("greeting hour", () => {
  it("follows Johannesburg, not UTC", () => {
    expect(jhbGreetingTitle(new Date("2026-11-07T08:30:00Z"))).toBe("Good morning");
    expect(jhbGreetingTitle(new Date("2026-11-07T10:30:00Z"))).toBe("Good afternoon");
    expect(jhbGreetingTitle(new Date("2026-11-07T16:30:00Z"))).toBe("Good evening");
  });
});
