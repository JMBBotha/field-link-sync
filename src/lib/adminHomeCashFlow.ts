/**
 * Admin-home cash-flow glance.
 * Pure. The signed-in company is the only company that counts.
 * Massair CT must not pick up Massair Ind CC or Test HVAC.
 * Call-out fees are never subtracted from customer money.
 *
 * A unit is a line classifyQuoteCategory would call "units" (the same rule as
 * cash-health _cf_is_unit_line). Labour, call-out and materials are not units.
 * Supplier cost includes VAT, matching cash health unitCostIncl:
 * catalogue cost including VAT, else cost excluding VAT × (1 + VAT rate).
 * A purchase-order cost is used only when the catalogue has no cost.
 * A cash-health commitment cost is never used — that sync guesses a factor
 * when it has no supplier price. Uncosted units stay out of the liability total.
 * Liability is only the uncovered quantity while the unit is still "needed"
 * (not ordered-and-paid, in stock, installed, or already allocated to stock).
 */
import { classifyQuoteCategory } from "@/lib/pricing";
import { invoiceMoney, type MoneyPayment } from "@/lib/moneySummary";
import { isSettledPayment } from "@/lib/payments";
import { formatExpectedDate } from "@/lib/projectTracker";
import { invoiceHref, jobHref } from "@/lib/recordLinks";

export const MASSAIR_CT_ID = "361bf031-9cdb-4d7f-9bde-9eb95fa4725e";
export const MASSAIR_IND_ID = "7b0a1ac1-de4c-57c2-9274-49afe4344719";
export const TEST_HVAC_ID = "4ddd72cb-56b9-448a-a589-3490bbc464ae";

const VOID = new Set(["void", "cancelled", "canceled"]);
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** True only for the signed-in company. Test HVAC never counts. */
export function rowInCompany(signedIn: string | null | undefined, rowCompany: string | null | undefined): boolean {
  if (!signedIn || !rowCompany) return false;
  if (signedIn === TEST_HVAC_ID || rowCompany === TEST_HVAC_ID) return false;
  return rowCompany === signedIn;
}

export type OrderStatus = "needed" | "ordered_paid" | "in_stock" | "installed";

export interface CashInvoice {
  id: string;
  company_id?: string | null;
  status?: string | null;
  grand_total?: number | string | null;
  invoice_number?: string | null;
  customer_name?: string | null;
  expected_final_date?: string | null;
  sent_at?: string | null;
  archived_at?: string | null;
  quote_id?: string | null;
  /** Ignored. Never subtracted. */
  call_out_excl_vat?: number | null;
  job_id?: string | null;
  job_label?: string | null;
}

export interface CashPayment {
  id?: string;
  invoice_id: string;
  company_id?: string | null;
  amount: number | string;
  status?: string | null;
  gateway?: string | null;
}

export interface CashCredit {
  invoice_id: string;
  total: number | string;
  status?: string | null;
}

export interface CashLineInput {
  id: string;
  name: string;
  description?: string | null;
  quantity?: number | string | null;
  line_type?: string | null;
  service_id?: string | null;
  product_id?: string | null;
  quote_category?: string | null;
  is_bundle?: boolean | null;
  product_code?: string | null;
  product_category?: string | null;
  category?: string | null;
  supplier_type?: string | null;
}

export interface CashProductCost {
  id: string;
  cost_excl_vat?: number | string | null;
  cost_incl_vat?: number | string | null;
  vat_rate?: number | string | null;
  product_code?: string | null;
  product_category?: string | null;
  category?: string | null;
  supplier_type?: string | null;
  product_type?: string | null;
}

export interface CashCommitment {
  id: string;
  invoice_id?: string | null;
  company_id?: string | null;
  item?: string | null;
  kind?: string | null;
  qty?: number | string | null;
  status?: string | null;
  /** Present on cf_commitments. Not used as a price — the sync may have guessed it. */
  unit_cost_excl?: number | string | null;
}

export interface CashAllocation {
  commitment_id: string;
  qty?: number | string | null;
}

export interface CashPoLine {
  id: string;
  invoice_id?: string | null;
  company_id?: string | null;
  status?: string | null;
  description?: string | null;
  model_code?: string | null;
  unit_cost_excl_vat?: number | string | null;
  qty?: number | string | null;
}

export interface UnitAssessment {
  id: string;
  invoice_id: string;
  name: string;
  qty: number;
  uncovered: number;
  status: OrderStatus;
  /** Null when nobody has a supplier price. Not a guessed sell-price factor. */
  costIncl: number | null;
  costSource: "catalogue_incl" | "catalogue_excl" | "purchase_order" | "none";
  liability: number;
  uncosted: boolean;
}

export interface CashFlowLine {
  id: string;
  invoiceId: string;
  label: string;
  detail: string;
  amount: number;
  href: string;
  jobHref: string | null;
  jobLabel: string | null;
  uncosted?: boolean;
}

export interface CashWhenGroup {
  key: string;
  label: string;
  total: number;
  lines: CashFlowLine[];
}

export interface CashFlowGlance {
  invoices: number;
  moneyIn: number;
  liability: number;
  expectedFinals: number;
  /** Money in + expected finals − liability. Uncosted units are not in the liability. */
  netCover: number;
  uncostedUnits: number;
  moneyLines: CashFlowLine[];
  liabilityLines: CashFlowLine[];
  finalLines: CashFlowLine[];
  when: CashWhenGroup[];
}

const statusOf = (s?: string | null) => String(s || "").toLowerCase();

export function isSentInvoice(inv: Pick<CashInvoice, "status" | "sent_at" | "archived_at">): boolean {
  if (inv.archived_at) return false;
  const st = statusOf(inv.status);
  if (VOID.has(st)) return false;
  if (st === "draft" && !inv.sent_at) return false;
  if (st === "draft" && inv.sent_at) return true;
  return st !== "draft";
}

const norm = (s?: string | null) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

export function isUnitLine(line: CashLineInput): boolean {
  if (line.service_id) return false;
  const type = String(line.line_type || "");
  if (/^(service|labour|labor)$/i.test(type)) return false;
  return classifyQuoteCategory({
    product_category: line.product_category,
    category: line.category,
    item_type: line.line_type,
    quote_category: line.quote_category,
    item_name: line.name,
    short_name: line.name,
    product_code: line.product_code,
    description: line.description,
    supplier_type: line.supplier_type,
    is_bundle: line.is_bundle,
  }) === "units";
}

function vatRate(v: number | string | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 15;
}

/** Catalogue (or PO) cost including VAT. Never a sell price and never a cost factor. */
export function supplierCostIncl(p: { cost_incl_vat?: number | string | null; cost_excl_vat?: number | string | null; vat_rate?: number | string | null } | null | undefined): { cost: number; source: "catalogue_incl" | "catalogue_excl" } | null {
  if (!p) return null;
  const incl = Number(p.cost_incl_vat);
  if (incl > 0) return { cost: r2(incl), source: "catalogue_incl" };
  const excl = Number(p.cost_excl_vat);
  if (excl > 0) return { cost: r2(excl * (1 + vatRate(p.vat_rate) / 100)), source: "catalogue_excl" };
  return null;
}

function poRank(status?: string | null): { status: OrderStatus; rank: number } {
  const s = statusOf(status);
  if (s === "installed") return { status: "installed", rank: 3 };
  if (s === "received" || s === "in_stock") return { status: "in_stock", rank: 2 };
  if (["ordered", "sent", "ordered_paid", "paid"].includes(s)) return { status: "ordered_paid", rank: 1 };
  return { status: "needed", rank: 0 };
}

function commitRank(status?: string | null): { status: OrderStatus; rank: number } | null {
  const s = statusOf(status);
  if (s === "installed" || s === "in_stock" || s === "ordered_paid" || s === "needed") return poRank(s);
  return null;
}

function textsMatch(a?: string | null, b?: string | null): boolean {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y || x.length < 4 || y.length < 4) return false;
  return x.includes(y) || y.includes(x);
}

/**
 * Units on one invoice, costed against the supplier.
 * Invoice lines win. When the invoice itself does not name a unit (a deposit
 * line only), the linked quote's unit lines are used and marked as such.
 */
export function assessInvoiceUnits(input: {
  invoiceId: string;
  lines: CashLineInput[];
  quoteLines?: CashLineInput[];
  products?: CashProductCost[];
  commitments?: CashCommitment[];
  allocations?: CashAllocation[];
  poLines?: CashPoLine[];
}): UnitAssessment[] {
  const products = new Map((input.products || []).map((p) => [p.id, p]));
  const quoteLines = input.quoteLines || [];
  const invoiceUnits = input.lines.filter(isUnitLine);
  const source = invoiceUnits.length ? invoiceUnits : quoteLines.filter(isUnitLine).map((l) => ({ ...l, id: l.id || `quote:${input.invoiceId}` }));
  const fromQuote = invoiceUnits.length === 0;
  const commitments = (input.commitments || []).filter((c) => !c.invoice_id || c.invoice_id === input.invoiceId);
  const usedCommit = new Set<string>();
  const poLines = (input.poLines || []).filter((p) => !p.invoice_id || p.invoice_id === input.invoiceId);
  const allocOf = (id: string) => r2((input.allocations || []).filter((a) => a.commitment_id === id).reduce((s, a) => s + (Number(a.qty) || 0), 0));

  return source.map((line) => {
    const qty = Math.max(0, Number(line.quantity) || 0) || (qtyZero(line) ? 0 : 1);
    const product = line.product_id ? products.get(line.product_id) : undefined;
    const matchedQuote = !line.product_id ? quoteLines.find((q) => q.product_id && (textsMatch(q.name, line.name) || textsMatch(q.product_code, line.name) || textsMatch(q.name, line.description))) : undefined;
    const quoteProduct = matchedQuote?.product_id ? products.get(matchedQuote.product_id) : undefined;
    let priced = supplierCostIncl(product || quoteProduct || null);
    let costSource: UnitAssessment["costSource"] = priced?.source || "none";
    const commit = commitments.find((c) => {
      if (usedCommit.has(c.id)) return false;
      if (c.kind && statusOf(c.kind) !== "unit") return false;
      return textsMatch(c.item, line.name) || textsMatch(c.item, line.product_code) || textsMatch(c.item, product?.product_code) || textsMatch(c.item, line.description);
    }) || (source.length === 1 && commitments.filter((c) => !c.kind || statusOf(c.kind) === "unit").length === 1 ? commitments.find((c) => !c.kind || statusOf(c.kind) === "unit") : undefined);
    if (commit) usedCommit.add(commit.id);
    const po = poLines.find((p) => textsMatch(p.model_code, line.product_code || product?.product_code) || textsMatch(p.model_code, line.name) || textsMatch(p.description, line.name) || textsMatch(p.description, line.product_code));
    if (!priced && po && Number(po.unit_cost_excl_vat) > 0) {
      priced = { cost: r2(Number(po.unit_cost_excl_vat) * (1 + vatRate(product?.vat_rate) / 100)), source: "catalogue_excl" };
      costSource = "purchase_order";
    }
    const ranks = [commitRank(commit?.status), po ? poRank(po.status) : null].filter(Boolean) as { status: OrderStatus; rank: number }[];
    let status: OrderStatus = ranks.sort((a, b) => b.rank - a.rank)[0]?.status || "needed";
    const allocated = commit ? allocOf(commit.id) : 0;
    if (status === "needed" && qty > 0 && allocated >= qty - 0.001) status = "in_stock";
    const uncovered = status === "needed" ? r2(Math.max(0, qty - allocated)) : 0;
    const costIncl = priced?.cost ?? null;
    const uncosted = uncovered > 0 && !(costIncl && costIncl > 0);
    const liability = uncosted ? 0 : r2(uncovered * (costIncl || 0));
    return {
      id: fromQuote ? `q:${line.id}` : line.id,
      invoice_id: input.invoiceId,
      name: fromQuote ? `${line.name} (from the quote)` : line.name,
      qty, uncovered, status, costIncl, costSource, liability, uncosted,
    };
  });
}

function qtyZero(line: CashLineInput): boolean {
  return line.quantity === 0 || line.quantity === "0";
}

function invoiceLabel(inv: CashInvoice): string {
  return `${inv.invoice_number || "Invoice"} · ${inv.customer_name || "Client"}`;
}

function linksFor(inv: CashInvoice): { href: string; jobHref: string | null; jobLabel: string | null } {
  return {
    href: `${invoiceHref(inv.id)}#expected-final`,
    jobHref: inv.job_id ? jobHref(inv.job_id) : null,
    jobLabel: inv.job_id ? (inv.job_label || "Job") : null,
  };
}

const ORDER_WORD: Record<OrderStatus, string> = {
  needed: "still to order",
  ordered_paid: "ordered and paid",
  in_stock: "in stock",
  installed: "installed",
};

export function countCashFlow(input: {
  companyId: string;
  invoices?: CashInvoice[];
  payments?: CashPayment[];
  credits?: CashCredit[];
  linesByInvoice?: Record<string, CashLineInput[]>;
  quoteLinesByQuote?: Record<string, CashLineInput[]>;
  products?: CashProductCost[];
  commitments?: CashCommitment[];
  allocations?: CashAllocation[];
  poLines?: CashPoLine[];
}): CashFlowGlance {
  const companyId = input.companyId;
  const empty: CashFlowGlance = { invoices: 0, moneyIn: 0, liability: 0, expectedFinals: 0, netCover: 0, uncostedUnits: 0, moneyLines: [], liabilityLines: [], finalLines: [], when: [] };
  if (!companyId || companyId === TEST_HVAC_ID) return empty;
  const invoices = (input.invoices || []).filter((inv) => rowInCompany(companyId, inv.company_id) && isSentInvoice(inv));
  const byId = new Map(invoices.map((inv) => [inv.id, inv]));
  const payments = (input.payments || []).filter((p) => {
    if (!byId.has(p.invoice_id)) return false;
    if (p.company_id && !rowInCompany(companyId, p.company_id)) return false;
    return isSettledPayment(p);
  });
  const credits = (input.credits || []).filter((c) => byId.has(c.invoice_id));
  const paysFor = (id: string): MoneyPayment[] => payments.filter((p) => p.invoice_id === id).map((p) => ({ invoice_id: p.invoice_id, amount: p.amount, status: p.status, gateway: p.gateway }));
  const creditFor = (id: string) => credits.filter((c) => c.invoice_id === id);
  const commitments = (input.commitments || []).filter((c) => !c.company_id || rowInCompany(companyId, c.company_id));
  const poLines = (input.poLines || []).filter((p) => !p.company_id || rowInCompany(companyId, p.company_id));

  const moneyLines: CashFlowLine[] = [];
  const liabilityLines: CashFlowLine[] = [];
  const finalLines: CashFlowLine[] = [];
  let uncostedUnits = 0;

  for (const inv of invoices) {
    const paid = invoiceMoney({ id: inv.id, status: inv.status ?? null, grand_total: inv.grand_total ?? 0, quote_id: inv.quote_id ?? null }, paysFor(inv.id), creditFor(inv.id));
    if (!(paid.paid > 0)) continue;
    const link = linksFor(inv);
    moneyLines.push({
      id: inv.id,
      invoiceId: inv.id,
      label: invoiceLabel(inv),
      detail: paid.credited > 0 ? `${formatMoney(paid.paid)} in · credit ${formatMoney(paid.credited)} does not reduce money in` : "Deposit or part payment in",
      amount: paid.paid,
      ...link,
    });
    const units = assessInvoiceUnits({
      invoiceId: inv.id,
      lines: input.linesByInvoice?.[inv.id] || [],
      quoteLines: inv.quote_id ? input.quoteLinesByQuote?.[inv.quote_id] || [] : [],
      products: input.products,
      commitments: commitments.filter((c) => c.invoice_id === inv.id),
      allocations: input.allocations,
      poLines: poLines.filter((p) => p.invoice_id === inv.id),
    });
    for (const u of units) {
      if (u.uncosted) uncostedUnits += 1;
      if (!(u.liability > 0) && !u.uncosted) continue;
      liabilityLines.push({
        id: `${inv.id}:${u.id}`,
        invoiceId: inv.id,
        label: `${invoiceLabel(inv)} · ${u.name}`,
        detail: u.uncosted
          ? `${u.uncovered} still to order · uncosted (no supplier price)`
          : `${u.uncovered} × ${formatMoney(u.costIncl || 0)} incl. VAT · ${ORDER_WORD[u.status]} · ${u.costSource === "purchase_order" ? "purchase order cost" : "catalogue cost"}`,
        amount: u.liability,
        uncosted: u.uncosted,
        ...link,
      });
    }
    if (paid.balance > 0) {
      const when = inv.expected_final_date ? formatExpectedDate(inv.expected_final_date) : null;
      finalLines.push({
        id: inv.id,
        invoiceId: inv.id,
        label: invoiceLabel(inv),
        detail: when ? `Expected ${when}` : "Date not set",
        amount: paid.balance,
        ...link,
      });
    }
  }

  const moneyIn = r2(moneyLines.reduce((s, l) => s + l.amount, 0));
  const liability = r2(liabilityLines.reduce((s, l) => s + l.amount, 0));
  const expectedFinals = r2(finalLines.reduce((s, l) => s + l.amount, 0));
  const whenMap = new Map<string, CashWhenGroup>();
  for (const line of finalLines) {
    const inv = byId.get(line.invoiceId)!;
    const key = inv.expected_final_date ? inv.expected_final_date.slice(0, 10) : "unset";
    const label = key === "unset" ? "Date not set" : (formatExpectedDate(key) || key);
    const g = whenMap.get(key) || { key, label, total: 0, lines: [] };
    g.lines.push(line);
    g.total = r2(g.total + line.amount);
    whenMap.set(key, g);
  }
  const when = [...whenMap.values()].sort((a, b) => (a.key === "unset" ? 1 : b.key === "unset" ? -1 : a.key.localeCompare(b.key)));
  return {
    invoices: moneyLines.length,
    moneyIn, liability, expectedFinals,
    netCover: r2(moneyIn + expectedFinals - liability),
    uncostedUnits,
    moneyLines, liabilityLines, finalLines, when,
  };
}

export function formatMoney(n: number): string {
  const v = r2(n);
  const sign = v < 0 ? "-" : "";
  const parts = Math.abs(v).toFixed(2).split(".");
  const body = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}R ${body},${parts[1]}`;
}

export const CASH_RULES = {
  money: "Money already in on this company's sent invoices that have a deposit or part payment. Drafts not sent, void invoices, and other companies are left out. Pending payments are not in. A call-out fee is never deducted.",
  liability: "Supplier cost, including VAT, of units on those invoices that still have to be ordered. Catalogue cost including VAT, or cost excluding VAT plus VAT (15% when the product has no rate) — the same incl-VAT rule as cash health. A purchase-order cost is used only when the catalogue has no price. Ordered-and-paid, in stock, installed, and stock already allocated are not still to buy. Labour and call-out are not units. A line with no supplier price is listed as uncosted and is not given a guessed price.",
  finals: "What the customer still has to pay on those invoices, after settled payments and issued credit notes. The date is the invoice's expected final date. Invoices with money still due and no expected final date are grouped as Date not set. Changing that date does not change the amount. A call-out fee is never deducted.",
  cover: "Net cover is money already in, plus the finals still expected, minus the supplier cost of units still to order. It is a glance, not one accounting total. Uncosted units are left out of the subtraction.",
};
