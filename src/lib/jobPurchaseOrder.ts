/**
 * Purchase orders for units that are short on a job this week.
 * A line already on a purchase order for that job is covered: a draft is "PO raised",
 * a sent order is "Ordered". Covered lines are not shortages, so the home card stops nagging.
 * Prices are the catalogue cost only. Nothing here writes a quote, an invoice, or stock.
 */
import { inSignedInCompany } from "@/lib/adminHomeCount";
import { isInstallUnit, stockNeedsFromChecks, type CheckKind, type MaterialCheck, type MaterialLine } from "@/lib/materialCheck";

export const PO_ACCOUNTS_EMAIL = "accounts@0800becool.co.za";
export const PO_DOCS_LINE = "Send invoices and delivery notes to: accounts@0800becool.co.za";
export const PO_COMPANY_FALLBACK = "Massair CT (Pty) Ltd";

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
const SENT = new Set(["sent", "ordered", "received"]);

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function poIssuerName(legalName: string | null | undefined): string {
  const stripped = String(legalName || "").replace(/\s+t\/a\b.*$/i, "").replace(/\s+/g, " ").trim();
  if (!stripped || /massair\s+ind/i.test(stripped)) return PO_COMPANY_FALLBACK;
  return stripped;
}

export function poIssuerProfile<T extends { legal_name?: string | null; trading_name?: string | null }>(profile: T | null): T | null {
  if (!profile) return profile;
  const trading = profile.trading_name && /t\/a|massair\s+ind/i.test(profile.trading_name) ? null : profile.trading_name;
  return { ...profile, legal_name: poIssuerName(profile.legal_name), trading_name: trading ?? null };
}

/** True when a document still carries the trading style or Massair Ind. */
export function poTextHasBanned(text: string): boolean {
  return /t\/a\s*0800-?be-?cool/i.test(text) || /massair\s+ind/i.test(text);
}

export function parseEmailList(raw: string): { emails: string[]; invalid: string[] } {
  const emails: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const part of String(raw || "").split(/[,;\s]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const email = trimmed.toLowerCase();
    if (!EMAIL.test(email)) invalid.push(trimmed);
    else if (!seen.has(email)) {
      seen.add(email);
      emails.push(email);
    }
  }
  return { emails, invalid };
}

/** Addresses saved on the supplier. The accounts copy is never stored as the supplier's own email. */
export function supplierEmailsToSave(existing: string[] | null | undefined, typed: string[]): string[] {
  const { emails } = parseEmailList([...(existing || []), ...typed].join(", "));
  return emails.filter((email) => email !== PO_ACCOUNTS_EMAIL);
}

export function emailsOnFile(orderEmails: string[] | null | undefined, mainEmail: string | null | undefined): string[] {
  const listed = (orderEmails || []).map((email) => email.trim().toLowerCase()).filter((email) => EMAIL.test(email));
  if (listed.length) return [...new Set(listed)];
  const main = String(mainEmail || "").trim().toLowerCase();
  return EMAIL.test(main) ? [main] : [];
}

export function poRecipients(supplierEmails: string[]): { to: string[]; cc: string[] } {
  const to = supplierEmails.map((email) => email.trim().toLowerCase()).filter((email) => EMAIL.test(email) && email !== PO_ACCOUNTS_EMAIL);
  return { to: [...new Set(to)], cc: [PO_ACCOUNTS_EMAIL] };
}

export function poTotals(lines: { qty: number; unitCost: number }[]): { subtotal: number; vat: number; total: number } {
  const subtotal = round2(lines.reduce((sum, line) => sum + round2(line.qty * line.unitCost), 0));
  const vat = round2(subtotal * 0.15);
  return { subtotal, vat, total: round2(subtotal + vat) };
}

export function formatPoMoney(n: number): string {
  return "R " + n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatPoDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Johannesburg" });
}

export function formatJobWhen(iso: string | null | undefined): string {
  if (!iso) return "Date not set";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Date not set";
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Johannesburg" });
}

export interface OrderCandidate {
  quoteItemId: string;
  productId: string;
  supplierId: string;
  supplierName: string;
  code: string | null;
  description: string;
  quotedQty: number;
  onHand: number;
  /** Already on a non-cancelled purchase order for this job. */
  alreadyOnPo: boolean;
  /** Catalogue cost excl VAT. Null or zero is missing, not a price we invent. */
  unitCostExcl: number | null;
  isUnit: boolean;
}

export interface PlannedPoLine {
  quoteItemId: string;
  productId: string;
  code: string | null;
  description: string;
  qty: number;
  unitCost: number;
  lineTotal: number;
}

export interface PlannedPo {
  supplierId: string;
  supplierName: string;
  lines: PlannedPoLine[];
  subtotal: number;
  vat: number;
  total: number;
}

/** One draft per supplier, short quantity only, catalogue cost only. Lines already on a PO are left out. */
export function planJobPurchaseOrders(lines: OrderCandidate[]): {
  drafts: PlannedPo[];
  missingPrice: { description: string; code: string | null }[];
  covered: string[];
} {
  const groups = new Map<string, PlannedPo & { pending: { qty: number; unitCost: number }[] }>();
  const missingPrice: { description: string; code: string | null }[] = [];
  const covered: string[] = [];
  for (const line of lines) {
    if (!line.isUnit) continue;
    if (line.alreadyOnPo) {
      covered.push(line.quoteItemId);
      continue;
    }
    const short = Math.round((line.quotedQty - line.onHand) * 1000) / 1000;
    if (!(short > 0)) continue;
    if (line.unitCostExcl == null || !(line.unitCostExcl > 0)) {
      missingPrice.push({ description: line.description, code: line.code });
      continue;
    }
    const unitCost = round2(line.unitCostExcl);
    const pending = { qty: short, unitCost };
    const current = groups.get(line.supplierId) || {
      supplierId: line.supplierId,
      supplierName: line.supplierName,
      lines: [],
      pending: [],
      subtotal: 0,
      vat: 0,
      total: 0,
    };
    current.lines.push({
      quoteItemId: line.quoteItemId,
      productId: line.productId,
      code: line.code,
      description: line.description,
      qty: short,
      unitCost,
      lineTotal: round2(short * unitCost),
    });
    current.pending.push(pending);
    groups.set(line.supplierId, current);
  }
  const drafts = [...groups.values()].map((group) => {
    const totals = poTotals(group.pending);
    return {
      supplierId: group.supplierId,
      supplierName: group.supplierName,
      lines: group.lines,
      subtotal: totals.subtotal,
      vat: totals.vat,
      total: totals.total,
    };
  });
  drafts.sort((a, b) => a.supplierName.localeCompare(b.supplierName));
  return { drafts, missingPrice, covered };
}

export interface LinkedPoLine {
  quoteItemId?: string | null;
  productId?: string | null;
  qty?: number;
}

export interface LinkedPo {
  id: string;
  jobId: string;
  companyId?: string | null;
  poNumber: string;
  status: string;
  sentAt?: string | null;
  createdAt?: string | null;
  lines: LinkedPoLine[];
}

export type LineCover =
  | { state: "needs" }
  | { state: "raised"; poNumber: string; poId: string }
  | { state: "ordered"; poNumber: string; poId: string; dateLabel: string };

function poMatchesLine(po: LinkedPo, line: { key: string; productId?: string | null }): boolean {
  return po.lines.some((item) =>
    (item.quoteItemId && item.quoteItemId === line.key) ||
    (item.productId && line.productId && item.productId === line.productId));
}

/** Draft (or approved) → PO raised. Sent, ordered or received → Ordered. Cancelled and other companies do not cover. */
export function coverForLine(
  jobId: string,
  line: { key: string; productId?: string | null },
  pos: LinkedPo[],
  companyId: string,
): LineCover {
  const hits = pos.filter((po) =>
    po.jobId === jobId &&
    po.status !== "cancelled" &&
    (!po.companyId || po.companyId === companyId) &&
    inSignedInCompany(po.companyId || companyId, companyId) &&
    poMatchesLine(po, line));
  const sent = hits.find((po) => SENT.has(po.status));
  if (sent) {
    return {
      state: "ordered",
      poNumber: sent.poNumber,
      poId: sent.id,
      dateLabel: formatPoDate(sent.sentAt || sent.createdAt || ""),
    };
  }
  const draft = hits.find((po) => po.status === "draft" || po.status === "approved");
  if (draft) return { state: "raised", poNumber: draft.poNumber, poId: draft.id };
  return { state: "needs" };
}

export interface WeekUnitLine {
  /** Quote item id when we have one. A purchase order line matches this or the product id. */
  key: string;
  productId?: string | null;
  /** Material-check line to take out of the product list, when that id differs from the quote item. */
  checkLineId?: string | null;
  label: string;
  status: MaterialLine["status"];
  shortQty: number | null;
}

export interface QuoteUnitSource {
  id: string;
  name?: string | null;
  productId?: string | null;
  productType?: string | null;
  code?: string | null;
}

/** Install units from the quote, matched onto the material check so a purchase order can cover them. */
export function unitLinesFromSources(check: MaterialCheck, items: QuoteUnitSource[]): {
  unitLines: WeekUnitLine[];
  productByLine: Record<string, string | null>;
} {
  const productByLine: Record<string, string | null> = {};
  const used = new Set<string>();
  const unitLines: WeekUnitLine[] = [];
  for (const item of items) {
    const unit = (item.productType || "").toLowerCase() === "ac_unit"
      || isInstallUnit({ id: item.id, name: item.name, code: item.code, productType: item.productType, source: "quote" });
    if (!unit) continue;
    const code = item.code || "";
    const name = (item.name || "").toLowerCase();
    const checkLine = check.lines.find((line) =>
      line.id === item.id
      || (!!code && (line.id.includes(code) || line.label.includes(code)))
      || (!!name && line.label.toLowerCase().includes(name)));
    if (checkLine) used.add(checkLine.id);
    unitLines.push({
      key: item.id,
      productId: item.productId || null,
      checkLineId: checkLine?.id || item.id,
      label: code || item.name || "Unit",
      status: checkLine?.status || "stock_unknown",
      shortQty: checkLine?.shortQty ?? null,
    });
    productByLine[item.id] = item.productId || null;
    if (checkLine && item.productId) productByLine[checkLine.id] = item.productId;
  }
  for (const line of check.lines) {
    if (used.has(line.id)) continue;
    if (!isInstallUnit({ id: line.id, name: line.label, source: "quote" })) continue;
    unitLines.push({
      key: line.id,
      productId: null,
      checkLineId: line.id,
      label: line.label,
      status: line.status,
      shortQty: line.shortQty,
    });
  }
  return { unitLines, productByLine };
}

export interface WeekStockJob {
  jobId: string;
  href: string;
  companyId: string | null;
  client: string;
  title: string;
  scheduledFor: string | null;
  kind: CheckKind;
  check: MaterialCheck;
  /** Install-unit lines on this job. Coverage is decided per line. */
  unitLines: WeekUnitLine[];
  /** quote item id → catalogue product, so a PO line can match either id. */
  productByLine?: Record<string, string | null | undefined>;
}

export interface UnitShortageLine {
  key: string;
  label: string;
  state: LineCover["state"];
  poNumber: string | null;
  poId: string | null;
  dateLabel: string | null;
  shortQty: number | null;
}

export interface UnitShortageRow {
  jobId: string;
  href: string;
  title: string;
  when: string;
  lines: UnitShortageLine[];
}

function productOf(job: WeekStockJob, lineId: string): string | null {
  return job.productByLine?.[lineId] || job.unitLines.find((line) => line.key === lineId)?.productId || null;
}

function dropLines(check: MaterialCheck, drop: Set<string>): MaterialCheck {
  const lines = check.lines.filter((line) => !drop.has(line.id));
  return { ...check, lines, toPickCount: lines.filter((line) => line.status === "to_pick").length };
}

/**
 * Material rows stay in the aggregated list. Unit rows are the job lines.
 * A covered line is removed from both, so it is not counted as short.
 */
export function assembleWeekStock(companyId: string, jobs: WeekStockJob[], pos: LinkedPo[]): {
  orders: ReturnType<typeof stockNeedsFromChecks>["orders"];
  levels: ReturnType<typeof stockNeedsFromChecks>["levels"];
  unitRows: UnitShortageRow[];
  nagCount: number;
} {
  const scoped = jobs.filter((job) => inSignedInCompany(job.companyId, companyId));
  const unitRows: UnitShortageRow[] = [];
  const forOrders: { href: string; kind: CheckKind; company_id?: string | null; check: MaterialCheck }[] = [];
  const forLevels: { href: string; kind: CheckKind; company_id?: string | null; check: MaterialCheck }[] = [];

  for (const job of scoped) {
    const unitIds = new Set(job.unitLines.flatMap((line) => [line.key, line.checkLineId].filter((id): id is string => !!id)));
    const covered = new Set<string>();
    for (const line of job.check.lines) {
      const cover = coverForLine(job.jobId, { key: line.id, productId: productOf(job, line.id) }, pos, companyId);
      if (cover.state !== "needs") covered.add(line.id);
    }
    const lines: UnitShortageLine[] = [];
    for (const line of job.unitLines) {
      const cover = coverForLine(job.jobId, { key: line.key, productId: line.productId }, pos, companyId);
      if (line.status !== "to_pick" && cover.state === "needs") continue;
      lines.push({
        key: line.key,
        label: line.label.replace(/ · .*$/, ""),
        state: cover.state,
        poNumber: cover.state === "needs" ? null : cover.poNumber,
        poId: cover.state === "needs" ? null : cover.poId,
        dateLabel: cover.state === "ordered" ? cover.dateLabel : null,
        shortQty: cover.state === "needs" ? line.shortQty : null,
      });
    }
    if (lines.length) {
      unitRows.push({
        jobId: job.jobId,
        href: job.href,
        title: job.client || job.title || "Job",
        when: formatJobWhen(job.scheduledFor),
        lines,
      });
    }
    const orderDrop = new Set<string>([...unitIds, ...covered]);
    forOrders.push({ href: job.href, kind: job.kind, company_id: job.companyId, check: dropLines(job.check, orderDrop) });
    forLevels.push({ href: job.href, kind: job.kind, company_id: job.companyId, check: dropLines(job.check, covered) });
  }

  const orders = stockNeedsFromChecks(companyId, forOrders).orders;
  const levels = stockNeedsFromChecks(companyId, forLevels).levels;
  const unitNeeds = unitRows.reduce((sum, row) => sum + row.lines.filter((line) => line.state === "needs").length, 0);
  unitRows.sort((a, b) => a.title.localeCompare(b.title));
  return { orders, levels, unitRows, nagCount: orders.length + unitNeeds };
}

export interface PoDraftView {
  id: string;
  poNumber: string;
  status: string;
  supplierId: string;
  supplierName: string;
  emails: string[];
  lines: { code: string | null; description: string; qty: number; unitCost: number; lineTotal: number; quoteItemId?: string | null; productId?: string | null }[];
  subtotal: number;
  vat: number;
  total: number;
  sentAt: string | null;
  createdAt: string | null;
  clientName: string | null;
  jobReference: string | null;
  accountNumber: string | null;
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** The create-draft call returns drafts and any orders already sent. The screen does not send from this. */
export function previewFromRpc(data: unknown): {
  drafts: PoDraftView[];
  ordered: PoDraftView[];
  missingPrice: { description: string; code: string | null }[];
} {
  const body = (data && typeof data === "object" ? data : {}) as {
    purchase_orders?: unknown;
    missing_price?: unknown;
  };
  const rows = Array.isArray(body.purchase_orders) ? body.purchase_orders : [];
  const views = rows.map((raw) => {
    const row = raw as Record<string, unknown>;
    const lines = Array.isArray(row.lines) ? row.lines : [];
    return {
      id: String(row.id || ""),
      poNumber: String(row.po_number || ""),
      status: String(row.status || "draft"),
      supplierId: String(row.supplier_id || ""),
      supplierName: String(row.supplier_name || "Supplier"),
      emails: Array.isArray(row.supplier_emails) ? row.supplier_emails.map((email) => String(email)) : [],
      lines: lines.map((item) => {
        const line = item as Record<string, unknown>;
        return {
          code: line.model_code == null ? null : String(line.model_code),
          description: String(line.description || line.model_code || "Unit"),
          qty: num(line.qty),
          unitCost: num(line.unit_cost_excl_vat),
          lineTotal: num(line.line_total_excl_vat),
          quoteItemId: line.quote_item_id == null ? null : String(line.quote_item_id),
          productId: line.product_id == null ? null : String(line.product_id),
        };
      }),
      subtotal: num(row.subtotal),
      vat: num(row.vat_amount),
      total: num(row.total),
      sentAt: row.sent_at == null ? null : String(row.sent_at),
      createdAt: row.created_at == null ? null : String(row.created_at),
      clientName: row.client_name == null ? null : String(row.client_name),
      jobReference: row.job_reference == null ? null : String(row.job_reference),
      accountNumber: row.supplier_account_number == null ? null : String(row.supplier_account_number),
    } satisfies PoDraftView;
  }).filter((row) => row.id);
  const missingRaw = Array.isArray(body.missing_price) ? body.missing_price : [];
  return {
    drafts: views.filter((row) => row.status === "draft" || row.status === "approved"),
    ordered: views.filter((row) => SENT.has(row.status)),
    missingPrice: missingRaw.map((item) => {
      const row = item as Record<string, unknown>;
      return { description: String(row.description || "Unit"), code: row.code == null ? null : String(row.code) };
    }),
  };
}

export function purchaseOrderEmailHtml(input: {
  companyName: string;
  poNumber: string;
  supplierName: string;
  lines: { qty: number; code: string | null; description: string; lineTotal: number }[];
  total: number;
}): string {
  const company = poIssuerName(input.companyName);
  const rows = input.lines.map((line) =>
    `<tr><td>${line.qty}</td><td>${line.code || ""}</td><td>${line.description}</td><td>${formatPoMoney(line.lineTotal)}</td></tr>`).join("");
  return [
    `<p>${company}</p>`,
    `<p>Purchase order ${input.poNumber} for ${input.supplierName}</p>`,
    `<table>${rows}</table>`,
    `<p>Total incl VAT ${formatPoMoney(input.total)}</p>`,
    `<p>${PO_DOCS_LINE}</p>`,
  ].join("");
}
