/** Expected deposits and finals, one row per house.
 *  The tile totals stay countAdminHome. This only groups those invoices so a house shows
 *  its deposit and its final together. Nothing here writes an invoice or a payment.
 *  A house link is invoices.project_house_id. When that invoice has invoice_house_coverage
 *  rows, those houses are used instead, so one invoice can name every ERF it covers. */
import { fmtDay } from "@/lib/balanceDue";
import { compareHouseLabels } from "@/lib/houseOrder";
import { invoiceMoney } from "@/lib/moneySummary";
import { isSettledPayment } from "@/lib/payments";
import { countAdminHome, inSignedInCompany, isDepositInvoiceNote, type HomeCredit, type HomeInvoice, type HomePayment } from "@/lib/adminHomeCount";
import { jhbDate } from "@/lib/drilldown";
import { namesHouse } from "@/lib/projectTracker";
import {
  computeExpectedLines,
  expectedSchedule,
  expectInvoiceFromHome,
  isLate,
  PAY_EXPECT_DEFAULTS,
  type ExpectContext,
  type ExpectCoverage,
  type ExpectHouse,
  type ExpectProject,
} from "@/lib/expectedPayDates";
import { formatRand } from "@/utils/formatRand";

export type HouseMoneyTone = "received" | "due" | "late" | "none";
export type HouseMoneySide = "deposits" | "finals" | "both";

export interface HouseJobRef {
  id: string;
  title?: string | null;
  description?: string | null;
  customerName?: string | null;
  customerId?: string | null;
  address?: string | null;
  invoiceId?: string | null;
  quoteId?: string | null;
  leadId?: string | null;
}

export interface HouseMoneyEntry {
  key: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  href: string | null;
  amountLabel: string;
  expectedLabel: string;
  chip: string;
  tone: HouseMoneyTone;
  /** This entry is part of the deposit or final tile, so the row belongs on that panel. */
  inFigure: boolean;
}

export interface HouseMoneyRow {
  id: string;
  house: string;
  place: string;
  client: string;
  deposit: HouseMoneyEntry[];
  final: HouseMoneyEntry[];
  inDeposits: boolean;
  inFinals: boolean;
}

export interface HouseMoneyGroup {
  id: string;
  name: string;
  code: string | null;
  rows: HouseMoneyRow[];
}

export interface HouseMoneyPicture {
  groups: HouseMoneyGroup[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const VOID = new Set(["void", "cancelled", "canceled"]);

/** Same reading as yard paymentWhen, used only before the pay_expect picture has loaded. */
function storedExpectLabel(inv: HomeInvoice, part: "deposit" | "final"): { date: string | null; label: string } {
  const hand = inv.due_date_source === "manual" || inv.due_date_manual === true;
  const expected = (iso: string) => {
    const day = fmtDay(iso);
    return { date: jhbDate(iso), label: day ? `Expected ${day}` : "Date not set" };
  };
  const due = (iso: string) => {
    const day = fmtDay(iso);
    return { date: jhbDate(iso), label: day ? `Due ${day}` : "Date not set" };
  };
  if (part === "deposit") {
    if (inv.expected_deposit_date) return expected(inv.expected_deposit_date);
    if (inv.due_date && hand) return expected(inv.due_date);
    if (inv.due_date) return due(inv.due_date);
    return { date: null, label: "Date not set" };
  }
  if (inv.expected_final_date) return expected(inv.expected_final_date);
  if (inv.due_date && hand) return expected(inv.due_date);
  if (inv.final_unscheduled) return { date: null, label: "Due on completion" };
  if (inv.due_date) return due(inv.due_date);
  return { date: null, label: "Date not set" };
}

function houseTitle(houseNo: string): string {
  const n = houseNo.trim();
  if (/^\d{5,}$/.test(n)) return `ERF ${n}`;
  return n ? `House ${n}` : "House";
}

function live(inv: HomeInvoice, companyId: string): boolean {
  if (!inSignedInCompany(inv.company_id, companyId) || inv.archived_at) return false;
  const status = String(inv.status || "").toLowerCase();
  if (VOID.has(status)) return false;
  if (status === "draft" && !inv.sent_at) return false;
  return true;
}

interface Fact {
  inv: HomeInvoice;
  grand: number;
  paid: number;
  balance: number;
  receivedOn: string | null;
}

function receivedOn(inv: HomeInvoice, payments: HomePayment[]): string | null {
  const dates = payments
    .filter((p) => p.invoice_id === inv.id && isSettledPayment(p) && (Number(p.amount) || 0) > 0.005)
    .map((p) => jhbDate(p.payment_date))
    .filter((d): d is string => !!d)
    .sort();
  return dates.length ? dates[dates.length - 1] : null;
}

function housesFor(inv: HomeInvoice, catalog: Map<string, ExpectHouse>, coverage: ExpectCoverage[]): string[] {
  const linked = [...new Set(coverage.filter((row) => row.invoiceId === inv.id && catalog.has(row.projectHouseId)).map((row) => row.projectHouseId))];
  if (linked.length) return linked;
  if (inv.project_house_id && catalog.has(inv.project_house_id)) return [inv.project_house_id];
  return [];
}

function shareOf(invId: string, houseId: string, coverage: ExpectCoverage[]): number | null {
  const sum = coverage.filter((row) => row.invoiceId === invId && row.projectHouseId === houseId).reduce((s, row) => s + (Number(row.amountIncl) || 0), 0);
  return sum > 0 ? r2(sum) : null;
}

function jobFor(inv: HomeInvoice, jobs: HouseJobRef[]): HouseJobRef | null {
  return jobs.find((job) => job.invoiceId === inv.id)
    || (inv.quote_id ? jobs.find((job) => job.quoteId === inv.quote_id) : undefined)
    || (inv.lead_id ? jobs.find((job) => job.leadId === inv.lead_id) : undefined)
    || null;
}

function houseNamedBy(job: HouseJobRef, houses: ExpectHouse[], projects: ExpectProject[]): string | null {
  const owned = job.customerId
    ? new Set(projects.filter((project) => project.customerId && project.customerId === job.customerId).map((project) => project.id))
    : null;
  const candidates = houses.filter((house) => !owned || owned.has(house.projectId));
  const titled = candidates.filter((house) => namesHouse(job.title, house.houseNo));
  const hits = titled.length ? titled : candidates.filter((house) => namesHouse(job.description, house.houseNo));
  if (hits.length !== 1 && !owned) return null;
  return hits[0]?.id || null;
}

export function visibleHouseGroups(picture: HouseMoneyPicture, side: HouseMoneySide): HouseMoneyGroup[] {
  return picture.groups
    .map((group) => ({
      ...group,
      rows: group.rows.filter((row) => (side === "both" ? row.inDeposits || row.inFinals : side === "deposits" ? row.inDeposits : row.inFinals)),
    }))
    .filter((group) => group.rows.length > 0);
}

export function groupExpectedHouses(input: {
  companyId: string;
  today: string;
  invoices?: HomeInvoice[];
  payments?: HomePayment[];
  credits?: HomeCredit[];
  expect?: ExpectContext | null;
  jobs?: HouseJobRef[];
}): HouseMoneyPicture {
  const companyId = input.companyId;
  const invoices = input.invoices || [];
  const payments = (input.payments || []).filter((p) => !p.company_id || inSignedInCompany(p.company_id, companyId));
  const credits = input.credits || [];
  const expect = input.expect || null;
  const jobs = input.jobs || [];
  const catalog = new Map((expect?.houses || []).map((house) => [house.id, house]));
  const projects = expect?.projects || [];
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const coverage = expect?.coverage || [];
  const grace = expect?.settings.lateGraceDays ?? PAY_EXPECT_DEFAULTS.lateGraceDays;
  const counts = countAdminHome({ companyId, invoices, payments, credits });
  const depositIds = new Set(counts.deposit.lines.map((line) => line.id));
  const finalIds = new Set(counts.finalDue.lines.map((line) => line.id));

  const facts: Fact[] = [];
  for (const inv of invoices) {
    if (!live(inv, companyId)) continue;
    const money = invoiceMoney(
      { id: inv.id, status: inv.status ?? null, grand_total: inv.grand_total ?? 0, notes: inv.notes, quote_id: inv.quote_id },
      payments.filter((p) => p.invoice_id === inv.id).map((p) => ({ invoice_id: p.invoice_id, amount: p.amount, status: p.status, gateway: p.gateway })),
      credits.filter((c) => c.invoice_id === inv.id),
    );
    const grand = r2(Number(inv.grand_total) || 0);
    facts.push({ inv, grand, paid: money.paid, balance: money.balance, receivedOn: receivedOn(inv, payments) });
  }
  const byId = new Map(facts.map((fact) => [fact.inv.id, fact]));

  interface Target { key: string; houseId: string | null; projectId: string | null; job: HouseJobRef | null }
  const targetsOf = (fact: Fact): Target[] => {
    const houseIds = housesFor(fact.inv, catalog, coverage);
    if (houseIds.length) {
      return houseIds.map((houseId) => ({
        key: `house:${houseId}`,
        houseId,
        projectId: catalog.get(houseId)?.projectId || null,
        job: null,
      }));
    }
    const job = jobFor(fact.inv, jobs);
    if (job) return [{ key: `job:${job.id}`, houseId: null, projectId: null, job }];
    if (fact.inv.quote_id) return [{ key: `quote:${fact.inv.quote_id}`, houseId: null, projectId: null, job: null }];
    if (fact.inv.lead_id) return [{ key: `lead:${fact.inv.lead_id}`, houseId: null, projectId: null, job: null }];
    return [{ key: `inv:${fact.inv.id}`, houseId: null, projectId: null, job: null }];
  };
  const targetByInvoice = new Map(facts.map((fact) => [fact.inv.id, targetsOf(fact)]));

  const buckets = new Map<string, { target: Target; ids: string[] }>();
  const ensure = (target: Target) => {
    const cur = buckets.get(target.key);
    if (cur) return cur;
    const next = { target, ids: [] as string[] };
    buckets.set(target.key, next);
    return next;
  };
  const anchor = new Set<string>();
  for (const fact of facts) {
    if (!depositIds.has(fact.inv.id) && !finalIds.has(fact.inv.id)) continue;
    for (const target of targetByInvoice.get(fact.inv.id) || []) anchor.add(target.key);
  }

  const acceptance = expect ? computeExpectedLines({
    companyId,
    invoices: facts.map((fact) => expectInvoiceFromHome(
      fact.inv,
      isDepositInvoiceNote(fact.inv.notes) ? "deposit" : "final",
      fact.balance,
    )),
    invoicedQuoteIds: facts.map((fact) => fact.inv.quote_id).filter((id): id is string => !!id),
    context: expect,
  }).filter((line) => line.source === "acceptance") : [];

  const acceptanceKey = new Map<string, (typeof acceptance)[number]>();
  for (const line of acceptance) {
    const quote = expect?.quotes.find((row) => row.id === line.quoteId);
    const job = jobs.find((row) => row.quoteId === line.quoteId) || null;
    const named = job ? houseNamedBy(job, expect?.houses || [], projects) : null;
    const target: Target = named
      ? { key: `house:${named}`, houseId: named, projectId: catalog.get(named)?.projectId || null, job: null }
      : job
        ? { key: `job:${job.id}`, houseId: null, projectId: null, job }
        : { key: `quote:${line.quoteId}`, houseId: null, projectId: null, job: null };
    anchor.add(target.key);
    ensure(target);
    acceptanceKey.set(target.key, line);
    if (quote && !target.job && job) target.job = job;
  }

  for (const fact of facts) {
    if (String(fact.inv.status || "").toLowerCase() !== "paid" && !(fact.paid > 0.005) && !(fact.balance > 0.005)) continue;
    for (const target of targetByInvoice.get(fact.inv.id) || []) {
      if (!anchor.has(target.key)) continue;
      const bucket = ensure(target);
      if (!bucket.ids.includes(fact.inv.id)) bucket.ids.push(fact.inv.id);
    }
  }

  function entryFor(fact: Fact, part: "deposit" | "final", houseId: string | null): HouseMoneyEntry {
    const status = String(fact.inv.status || "").toLowerCase();
    const received = status === "paid" || (fact.paid > 0.005 && fact.balance <= 0.005);
    const partPaid = !received && fact.paid > 0.005 && fact.balance > 0.005;
    const open = !received && fact.balance > 0.005;
    const share = houseId ? shareOf(fact.inv.id, houseId, coverage) : null;
    let date: string | null = null;
    let expectedLabel = "Date not set";
    if (expect) {
      const placed = houseId ? { ...fact.inv, project_house_id: houseId } : fact.inv;
      const scheduled = expectedSchedule(expectInvoiceFromHome(placed, part, fact.balance), expect);
      date = scheduled?.date ?? null;
      expectedLabel = scheduled?.display
        || (part === "final" && fact.inv.final_unscheduled ? "Due on completion" : "Date not set");
    } else {
      const stored = storedExpectLabel(fact.inv, part);
      date = stored.date;
      expectedLabel = stored.label;
    }
    const late = open && !!date && isLate(date, input.today, grace);
    const amount = received
      ? (share ?? (fact.paid > 0.005 ? fact.paid : fact.grand))
      : (share != null && fact.grand > 0 ? r2(fact.balance * (share / fact.grand)) : fact.balance);
    const chip = received
      ? (fact.receivedOn ? `Received ${fmtDay(fact.receivedOn)}` : "Received")
      : partPaid
        ? `Part paid ${formatRand(fact.paid)} of ${formatRand(fact.grand)}`
        : late ? "Late" : "Due";
    return {
      key: fact.inv.id,
      invoiceId: fact.inv.id,
      invoiceNumber: fact.inv.invoice_number || "Invoice",
      href: `/admin/invoices/${fact.inv.id}`,
      amountLabel: formatRand(amount),
      expectedLabel,
      chip,
      tone: received ? "received" : late ? "late" : "due",
      inFigure: (part === "deposit" ? depositIds : finalIds).has(fact.inv.id),
    };
  }

  const rows: { groupId: string; name: string; code: string | null; sort: string; row: HouseMoneyRow }[] = [];
  for (const bucket of buckets.values()) {
    const deposit: HouseMoneyEntry[] = [];
    const final: HouseMoneyEntry[] = [];
    for (const id of bucket.ids) {
      const fact = byId.get(id);
      if (!fact) continue;
      const part = isDepositInvoiceNote(fact.inv.notes) ? "deposit" : "final";
      const entry = entryFor(fact, part, bucket.target.houseId);
      (part === "deposit" ? deposit : final).push(entry);
    }
    const pending = acceptanceKey.get(bucket.target.key);
    if (pending && deposit.length === 0) {
      const quote = expect?.quotes.find((row) => row.id === pending.quoteId);
      deposit.push({
        key: `quote:${pending.quoteId}`,
        invoiceId: null,
        invoiceNumber: null,
        href: pending.href,
        amountLabel: formatRand(pending.amount),
        expectedLabel: pending.display || "Date not set",
        chip: "Not invoiced yet",
        tone: "none",
        inFigure: true,
      });
      if (quote && !bucket.target.job) {
        bucket.target = { ...bucket.target, job: jobs.find((job) => job.quoteId === quote.id) || null };
      }
    }
    deposit.sort((a, b) => Number(b.inFigure) - Number(a.inFigure) || (a.invoiceNumber || "").localeCompare(b.invoiceNumber || ""));
    final.sort((a, b) => Number(b.inFigure) - Number(a.inFigure) || (a.invoiceNumber || "").localeCompare(b.invoiceNumber || ""));
    const inDeposits = deposit.some((entry) => entry.inFigure);
    const inFinals = final.some((entry) => entry.inFigure);
    if (!inDeposits && !inFinals) continue;
    const house = bucket.target.houseId ? catalog.get(bucket.target.houseId) : null;
    const project = house ? projectById.get(house.projectId) : null;
    const factClient = bucket.ids.map((id) => byId.get(id)?.inv.customer_name).find((name) => !!name?.trim()) || "";
    const job = bucket.target.job;
    const client = (factClient || job?.customerName || expect?.quotes.find((row) => pending && row.id === pending.quoteId)?.customerName || "Client").trim();
    const place = [house?.unit?.trim(), job?.address?.trim()].filter(Boolean).join(" · ");
    const title = house ? houseTitle(house.houseNo) : (job?.title?.trim() || client);
    rows.push({
      groupId: project ? project.id : "other",
      name: project?.name?.trim() || "Other jobs",
      code: project?.code?.trim() || null,
      sort: house ? house.houseNo : title,
      row: {
        id: bucket.target.key,
        house: title,
        place,
        client: client === title ? "" : client,
        deposit,
        final,
        inDeposits,
        inFinals,
      },
    });
  }

  const groups = new Map<string, HouseMoneyGroup>();
  for (const item of rows) {
    const group = groups.get(item.groupId) || { id: item.groupId, name: item.name, code: item.code, rows: [] };
    group.rows.push(item.row);
    groups.set(item.groupId, group);
  }
  const ordered = [...groups.values()].sort((a, b) => (a.id === "other" ? 1 : b.id === "other" ? -1 : a.name.localeCompare(b.name)));
  for (const group of ordered) {
    const sorts = new Map(rows.filter((item) => item.groupId === group.id).map((item) => [item.row.id, item.sort]));
    group.rows.sort((a, b) => compareHouseLabels(sorts.get(a.id), sorts.get(b.id)) || a.house.localeCompare(b.house));
  }
  return { groups: ordered };
}
