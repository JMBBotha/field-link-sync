import { supabase } from "@/integrations/supabase/client";
import type { TemplateSection } from "./markup";
import { buildAgreementPdf, type AgreementClient, type AgreementUnitRow } from "./pdf";
import { loadIssuingCompany } from "./api";

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as any;

export type ContractStatus = "draft" | "issued" | "signed" | "void";
export const FREQUENCY_OPTIONS = [
  { value: "annual", label: "Once a year" },
  { value: "biannual", label: "Twice a year" },
  { value: "quarterly", label: "Quarterly (4 visits a year)" },
  { value: "monthly", label: "Monthly" },
] as const;
export const frequencyLabel = (f?: string | null) => FREQUENCY_OPTIONS.find((o) => o.value === f)?.label || f || "";

export interface AgreementContract {
  id: string;
  company_id: string;
  customer_id: string;
  template_id: string | null;
  template_version: number | null;
  template_name: string | null;
  contract_number: string;
  title: string;
  status: ContractStatus;
  start_date: string | null;
  frequency: string | null;
  plan: string | null;
  client_snapshot: AgreementClient;
  units: AgreementUnitRow[];
  sections: TemplateSection[];
  source_invoice_ids: string[];
  source_job_ids: string[];
  service_agreement_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SourceRef { id: string; customer_id: string | null; label?: string }

/**
 * Same-client rule for multi-select (mirrors the server check in create_agreement_contract
 * and the agreement_contracts_guard trigger): every source must have the same, non-empty client.
 */
export function sameClientCheck(sources: SourceRef[]): { ok: true; customerId: string } | { ok: false; reason: string } {
  if (sources.length === 0) return { ok: false, reason: "Select at least one invoice or job." };
  const missing = sources.filter((s) => !s.customer_id);
  if (missing.length) return { ok: false, reason: `${missing.map((m) => m.label || "One item").join(", ")} ${missing.length === 1 ? "is" : "are"} not linked to a client.` };
  const ids = new Set(sources.map((s) => s.customer_id));
  if (ids.size > 1) return { ok: false, reason: "All selected invoices must be for the same client." };
  return { ok: true, customerId: sources[0].customer_id! };
}

export async function createAgreementContract(input: {
  templateId: string; customerId: string; invoiceIds?: string[]; jobIds?: string[];
  startDate?: string | null; frequency?: string | null; serviceAgreementId?: string | null;
}): Promise<string> {
  const { data, error } = await db.rpc("create_agreement_contract", {
    _template_id: input.templateId, _customer_id: input.customerId,
    _invoice_ids: input.invoiceIds || [], _job_ids: input.jobIds || [],
    _start_date: input.startDate || null, _frequency: input.frequency || "annual",
    _service_agreement_id: input.serviceAgreementId || null,
  });
  if (error) throw error;
  return String(data);
}

export async function getAgreementContract(id: string): Promise<AgreementContract> {
  const { data, error } = await db.from("agreement_contracts").select("*").eq("id", id).single();
  if (error) throw error;
  return data as AgreementContract;
}

export async function listAgreementContracts(customerId?: string): Promise<(AgreementContract & { customers?: { name: string } })[]> {
  let q = db.from("agreement_contracts")
    .select("id, company_id, customer_id, template_id, template_version, template_name, contract_number, title, status, start_date, frequency, source_invoice_ids, source_job_ids, service_agreement_id, created_at, updated_at, customers:customer_id (name)")
    .order("created_at", { ascending: false });
  if (customerId) q = q.eq("customer_id", customerId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function updateAgreementContract(id: string, patch: Partial<Pick<AgreementContract,
  "title" | "status" | "start_date" | "frequency" | "plan" | "client_snapshot" | "units" | "sections" | "notes">>) {
  const { error } = await db.from("agreement_contracts").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteAgreementContract(id: string) {
  const { error } = await db.from("agreement_contracts").delete().eq("id", id);
  if (error) throw error;
}

const fmtDate = (d?: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" }) : "");

export function contractFields(c: Pick<AgreementContract, "contract_number" | "start_date" | "frequency" | "client_snapshot">) {
  return {
    "client.name": c.client_snapshot?.name,
    "client.legal_name": c.client_snapshot?.legalName || c.client_snapshot?.name,
    "client.vat": c.client_snapshot?.vat,
    "client.address": c.client_snapshot?.siteAddress || c.client_snapshot?.postalAddress,
    "contract.number": c.contract_number,
    "contract.start_date": fmtDate(c.start_date),
    "contract.frequency": frequencyLabel(c.frequency),
  };
}

export async function downloadContractPdf(c: AgreementContract, linkedLabel?: string) {
  const company = await loadIssuingCompany();
  const doc = buildAgreementPdf({
    title: c.title || "Service contract",
    contractNo: c.contract_number,
    draft: c.status === "draft",
    company,
    client: c.client_snapshot,
    units: c.units,
    sections: c.sections,
    meta: { startDate: fmtDate(c.start_date), frequency: frequencyLabel(c.frequency), linked: linkedLabel },
    extraFields: contractFields(c),
  });
  const who = (c.client_snapshot?.name || "client").replace(/[^\w&() -]+/g, "").trim();
  doc.save(`${c.contract_number} ${who}.pdf`);
}
