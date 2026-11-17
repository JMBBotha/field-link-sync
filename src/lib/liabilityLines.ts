/** Job liabilities for the Home panel and the Cash-flow health list.
 *  The rows are exactly the lines jobLiabilities counts: deposit already in, job not installed,
 *  still to pay, stock already set aside left out. The total is that function's total.
 *  Nothing here writes a commitment, a job, or an invoice. */
import { fmtDay } from "@/lib/balanceDue";
import { allocatedQty, jobLiabilities, projects, stillToPay, type Allocation, type CashHealthData, type Commitment, type Receipt } from "@/lib/cashHealth";
import { compareHouseLabels } from "@/lib/houseOrder";
import { formatRand } from "@/utils/formatRand";

export const LIABILITY_SOURCE = "Where this comes from: units and materials still to buy for jobs whose deposit is already in, and which are not installed yet. The cost is the supplier price incl. VAT. Stock already set aside is left out. This is the same total as Cash-flow health job liabilities.";

export interface LiabilityInvoiceRef {
  id: string;
  invoiceNumber?: string | null;
  customerName?: string | null;
  projectHouseId?: string | null;
}

export interface LiabilityHouseRef {
  id: string;
  projectId: string;
  houseNo: string;
  unit?: string | null;
  projectName?: string | null;
  projectCode?: string | null;
}

export interface LiabilityCoverageRef {
  invoiceId: string;
  projectHouseId: string;
}

export interface LiabilityJobRef {
  id: string;
  title?: string | null;
  address?: string | null;
  customerName?: string | null;
}

export interface LiabilityContext {
  invoices?: LiabilityInvoiceRef[];
  houses?: LiabilityHouseRef[];
  coverage?: LiabilityCoverageRef[];
  jobs?: LiabilityJobRef[];
}

export interface LiabilityLineView {
  id: string;
  href: string;
  client: string;
  invoiceNumber: string | null;
  supplier: string | null;
  code: string;
  description: string;
  qtyLabel: string;
  amount: number;
  amountLabel: string;
  payLabel: string;
  /** YYYY-MM-DD, or null when the line has no pay date. Display only. */
  payDate: string | null;
}

export interface LiabilityHouseRow {
  id: string;
  house: string;
  place: string;
  client: string;
  lines: LiabilityLineView[];
}

export interface LiabilityGroup {
  id: string;
  name: string;
  code: string | null;
  rows: LiabilityHouseRow[];
}

export interface LiabilityPicture {
  total: number;
  source: string;
  groups: LiabilityGroup[];
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function qtyText(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function splitItem(item: string): { code: string; description: string } {
  const text = item.trim() || "Unit";
  const parts = text.split(/\s+[·•]\s+|\s+-\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return { code: parts[0], description: parts.slice(1).join(" · ") };
  return { code: text, description: "" };
}

function houseTitle(houseNo: string): string {
  const n = houseNo.trim();
  if (/^\d{5,}$/.test(n)) return `ERF ${n}`;
  return n ? `House ${n}` : "House";
}

function houseIdsFor(invoiceId: string | null, invoice: LiabilityInvoiceRef | undefined, houses: Map<string, LiabilityHouseRef>, coverage: LiabilityCoverageRef[]): string[] {
  if (!invoiceId) return [];
  const linked = [...new Set(coverage.filter((row) => row.invoiceId === invoiceId && houses.has(row.projectHouseId)).map((row) => row.projectHouseId))];
  if (linked.length) return linked;
  if (invoice?.projectHouseId && houses.has(invoice.projectHouseId)) return [invoice.projectHouseId];
  return [];
}

export function liabilityContextFromCash(data: Pick<CashHealthData, "invoices" | "coverage" | "jobs">): LiabilityContext {
  const houses = new Map<string, LiabilityHouseRef>();
  for (const inv of data.invoices) {
    const house = inv.project_house;
    if (!house?.id || !house.project_id) continue;
    houses.set(house.id, {
      id: house.id,
      projectId: house.project_id,
      houseNo: house.house_no || "",
      projectName: house.project?.name || null,
      projectCode: house.project?.code || null,
    });
  }
  for (const row of data.coverage || []) {
    if (!row.project_house_id || !row.project_id || houses.has(row.project_house_id)) continue;
    houses.set(row.project_house_id, {
      id: row.project_house_id,
      projectId: row.project_id,
      houseNo: row.house_no || "",
      projectName: row.project_name,
      projectCode: row.project_code,
    });
  }
  return {
    invoices: data.invoices.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoice_number,
      customerName: inv.customer_name,
      projectHouseId: inv.project_house?.id || null,
    })),
    houses: [...houses.values()],
    coverage: (data.coverage || []).map((row) => ({ invoiceId: row.invoice_id, projectHouseId: row.project_house_id })),
    jobs: (data.jobs || []).map((job) => ({ id: job.id, title: job.title, address: job.address, customerName: job.customer_name })),
  };
}

export function buildLiabilityPicture(
  receipts: Receipt[] | null,
  commitments: Commitment[] | null,
  allocations: Allocation[] | null,
  context: LiabilityContext = {},
): LiabilityPicture {
  if (!receipts || !commitments || !allocations) return { total: 0, source: LIABILITY_SOURCE, groups: [] };
  const data = { receipts, commitments, allocations };
  const summary = jobLiabilities(data);
  const houses = new Map((context.houses || []).map((house) => [house.id, house]));
  const invoices = new Map((context.invoices || []).map((inv) => [inv.id, inv]));
  const jobs = new Map((context.jobs || []).map((job) => [job.id, job]));
  const coverage = context.coverage || [];
  const open = projects(data).filter((project) => project.deposit?.received && project.status !== "installed");
  const raw = open.flatMap((project) => project.lines
    .filter((line) => stillToPay(line, allocations) > 0)
    .map((line) => ({ project, line, amount: stillToPay(line, allocations) })));

  interface Bucket { id: string; groupId: string; name: string; code: string | null; house: string; place: string; client: string; sort: string; lines: LiabilityLineView[] }
  const buckets = new Map<string, Bucket>();

  for (const row of raw) {
    const invoice = row.line.invoice_id ? invoices.get(row.line.invoice_id) : undefined;
    const ids = houseIdsFor(row.line.invoice_id, invoice, houses, coverage);
    const houseRows = ids.map((id) => houses.get(id)).filter((house): house is LiabilityHouseRef => !!house);
    const projectNames = [...new Set(houseRows.map((house) => house.projectName?.trim()).filter((name): name is string => !!name))];
    const projectCodes = [...new Set(houseRows.map((house) => house.projectCode?.trim()).filter((code): code is string => !!code))];
    const job = row.line.job_id ? jobs.get(row.line.job_id) : undefined;
    const client = (invoice?.customerName || row.project.client || job?.customerName || "Client").trim() || "Client";
    const invoiceNumber = invoice?.invoiceNumber || row.project.ref || null;
    const sameProject = new Set(houseRows.map((house) => house.projectId)).size <= 1;
    const grouped = houseRows.length > 0 && sameProject;
    const key = grouped
      ? `houses:${houseRows.map((house) => house.id).sort().join(",")}`
      : job
        ? `job:${job.id}`
        : row.line.invoice_id
          ? `inv:${row.line.invoice_id}`
          : `line:${row.line.id}`;
    const houseLabel = grouped
      ? houseRows.map((house) => houseTitle(house.houseNo)).join(", ")
      : (job?.title?.trim() || client);
    const place = grouped
      ? [...new Set(houseRows.map((house) => house.unit?.trim()).filter((unit): unit is string => !!unit)), job?.address?.trim()].filter(Boolean).join(" · ")
      : (job?.address?.trim() || "");
    const groupId = grouped ? (houseRows[0]?.projectId || "project") : "other";
    const name = grouped ? (projectNames[0] || "Project") : "Other jobs";
    const code = grouped ? (projectCodes[0] || null) : null;
    const item = splitItem(row.line.item);
    const allocated = allocatedQty(row.line, allocations);
    const remaining = Math.max(0, num(row.line.qty) - allocated);
    const line: LiabilityLineView = {
      id: row.line.id,
      href: row.line.job_id ? `/admin/jobs/${row.line.job_id}` : row.line.invoice_id ? `/admin/invoices/${row.line.invoice_id}` : "/admin/cash-health?tab=projects",
      client,
      invoiceNumber,
      supplier: row.line.supplier?.trim() || null,
      code: item.code,
      description: item.description,
      qtyLabel: `Qty ${qtyText(remaining)}`,
      amount: row.amount,
      amountLabel: formatRand(row.amount),
      payLabel: row.line.pay_date ? `Pay ${fmtDay(row.line.pay_date)}` : "No pay date",
      payDate: row.line.pay_date ? row.line.pay_date.slice(0, 10) : null,
    };
    const bucket = buckets.get(key) || {
      id: key, groupId, name, code, house: houseLabel, place, client, sort: grouped ? houseRows[0]?.houseNo || houseLabel : houseLabel, lines: [],
    };
    bucket.lines.push(line);
    buckets.set(key, bucket);
  }

  const groups = new Map<string, LiabilityGroup>();
  for (const bucket of buckets.values()) {
    bucket.lines.sort((a, b) => a.payLabel.localeCompare(b.payLabel) || a.code.localeCompare(b.code));
    const group = groups.get(bucket.groupId) || { id: bucket.groupId, name: bucket.name, code: bucket.code, rows: [] };
    group.rows.push({ id: bucket.id, house: bucket.house, place: bucket.place, client: bucket.client, lines: bucket.lines });
    groups.set(bucket.groupId, group);
  }
  const ordered = [...groups.values()].sort((a, b) => (a.id === "other" ? 1 : b.id === "other" ? -1 : a.name.localeCompare(b.name)));
  for (const group of ordered) {
    const sorts = new Map([...buckets.values()].filter((bucket) => bucket.groupId === group.id).map((bucket) => [bucket.id, bucket.sort]));
    group.rows.sort((a, b) => compareHouseLabels(sorts.get(a.id), sorts.get(b.id)) || a.house.localeCompare(b.house));
  }
  return { total: summary.total, source: LIABILITY_SOURCE, groups: ordered };
}

/** A view of the same lines. The source picture and its total are left as they are. */
export function filterLiabilityPicture(picture: LiabilityPicture, keep: (line: LiabilityLineView) => boolean): LiabilityPicture {
  const groups = picture.groups
    .map((group) => ({
      ...group,
      rows: group.rows
        .map((row) => ({ ...row, lines: row.lines.filter(keep) }))
        .filter((row) => row.lines.length > 0),
    }))
    .filter((group) => group.rows.length > 0);
  const total = Math.round(groups.reduce((sum, group) => sum + group.rows.reduce((rowSum, row) => rowSum + row.lines.reduce((lineSum, line) => lineSum + line.amount, 0), 0), 0) * 100) / 100;
  return { source: picture.source, groups, total };
}
