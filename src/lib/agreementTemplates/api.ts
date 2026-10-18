import { supabase } from "@/integrations/supabase/client";
import { COMPANY } from "@/lib/companyIdentity";
import { fetchCompanyProfiles, profileBanking, profileIdentity, type CompanyProfile } from "@/lib/companyProfiles";
import massairLogo from "@/assets/massair-0800-becool-card.png";
import type { TemplateSection } from "./markup";
import type { AgreementCompany } from "./pdf";

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = supabase as any;

export const AGREEMENT_DOCS_BUCKET = "agreement-docs";
export type TemplateStatus = "draft" | "active" | "archived";
export type TemplateFileKey = "contract_pdf_path" | "contract_docx_path" | "sla_docx_path" | "sla_pdf_path";

export const FILE_LABELS: Record<TemplateFileKey, string> = {
  contract_pdf_path: "Contract (original PDF)",
  contract_docx_path: "Contract (Word)",
  sla_docx_path: "SLA (Word)",
  sla_pdf_path: "SLA (PDF)",
};

export interface AgreementTemplate {
  id: string;
  company_id: string;
  name: string;
  tier: string | null;
  description: string | null;
  status: TemplateStatus;
  version: number;
  contract_pdf_path: string | null;
  contract_docx_path: string | null;
  sla_docx_path: string | null;
  sla_pdf_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface TemplateVersion {
  id: string;
  version: number;
  note: string | null;
  created_at: string;
  created_by: string | null;
  snapshot: { name: string; tier: string | null; description: string | null; status: TemplateStatus; sections: TemplateSection[] };
}

export async function listAgreementTemplates(): Promise<AgreementTemplate[]> {
  const { data, error } = await db.from("agreement_templates").select("*").order("status").order("name");
  if (error) throw error;
  return (data || []) as AgreementTemplate[];
}

export async function getTemplateSections(templateId: string): Promise<TemplateSection[]> {
  const { data, error } = await db.from("agreement_template_sections")
    .select("doc_kind, position, kind, heading, body").eq("template_id", templateId)
    .order("doc_kind").order("position");
  if (error) throw error;
  return (data || []) as TemplateSection[];
}

export async function listTemplateVersions(templateId: string): Promise<TemplateVersion[]> {
  const { data, error } = await db.from("agreement_template_versions")
    .select("id, version, note, created_at, created_by, snapshot").eq("template_id", templateId)
    .order("version", { ascending: false });
  if (error) throw error;
  return (data || []) as TemplateVersion[];
}

export async function saveAgreementTemplate(templateId: string,
  meta: { name: string; tier: string | null; description: string | null; status: TemplateStatus },
  sections: Omit<TemplateSection, never>[], note?: string): Promise<number> {
  const { data, error } = await db.rpc("save_agreement_template", { _template_id: templateId, _meta: meta, _sections: sections, _note: note || null });
  if (error) throw error;
  return Number(data);
}

/** New empty template (main-company admins only; RLS enforces). Version 1 is written by the first save. */
export async function createAgreementTemplate(companyId: string, name: string, tier: string | null): Promise<AgreementTemplate> {
  const { data, error } = await db.from("agreement_templates")
    .insert({ company_id: companyId, name, tier, status: "draft", version: 0 }).select("*").single();
  if (error) throw error;
  const sections: TemplateSection[] = [
    { doc_kind: "contract", position: 1, kind: "text", heading: "Parties and definitions", body: "1.1 This agreement is between **{{company.name}}** (VAT {{company.vat}}) of {{company.address}} and the client named on page 1." },
    { doc_kind: "contract", position: 2, kind: "signatures", heading: "Signatures", body: "" },
  ];
  await saveAgreementTemplate(data.id, { name, tier, description: null, status: "draft" }, sections, "Created");
  return { ...(data as AgreementTemplate), version: 1 };
}

const safeName = (n: string) => n.normalize("NFKD").replace(/[^\w.-]+/g, "_").replace(/_+/g, "_").slice(0, 80);

export function templateFilePath(companyId: string, templateId: string, key: TemplateFileKey, fileName: string): string {
  return `${companyId}/templates/${templateId}/${key.replace(/_path$/, "")}-${Date.now()}-${safeName(fileName)}`;
}

export async function uploadTemplateFile(t: AgreementTemplate, key: TemplateFileKey, file: File): Promise<string> {
  const path = templateFilePath(t.company_id, t.id, key, file.name);
  const { error } = await supabase.storage.from(AGREEMENT_DOCS_BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) throw error;
  const { error: e2 } = await db.from("agreement_templates").update({ [key]: path, updated_at: new Date().toISOString() }).eq("id", t.id);
  if (e2) throw e2;
  return path;
}

export async function signedTemplateFileUrl(path: string, download?: string): Promise<string> {
  const { data, error } = await supabase.storage.from(AGREEMENT_DOCS_BUCKET).createSignedUrl(path, 60 * 10, download ? { download } : undefined);
  if (error || !data?.signedUrl) throw error || new Error("No signed URL");
  return data.signedUrl;
}

async function toDataUrl(src: string): Promise<string | null> {
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(typeof r.result === "string" ? r.result : null);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch { return null; }
}

export function shortCompanyName(p: { company_id?: string; legal_name?: string | null; trading_name?: string | null }): string {
  if (p.company_id === COMPANY.companyId) return "Massair";
  const base = String(p.legal_name || p.trading_name || "").replace(/\s*\((pty|proprietary)\)\s*(ltd|limited)\.?$/i, "").replace(/\s+(pty\s+)?ltd\.?$/i, "").trim();
  return base || String(p.legal_name || "");
}

/** Issuing company for the PDF = the signed-in user's own company record (downline companies print their own details). */
export function agreementCompanyFromProfile(p: CompanyProfile | null, signatory?: string | null): AgreementCompany {
  const i = profileIdentity(p);
  const b = profileBanking(p);
  const banking = b && (b.bank_name || b.account_number)
    ? [b.account_name, b.bank_name, [b.account_type && `${b.account_type} account`, b.account_number].filter(Boolean).join(" "), b.branch_code && `Branch code ${b.branch_code}`].filter(Boolean).join(" · ")
    : "";
  const isMassair = !p || p.company_id === COMPANY.companyId;
  return {
    name: i.legalName,
    short: p ? shortCompanyName(p) : "Massair",
    vat: i.vatNo || null,
    addressLines: i.addressLines.length ? i.addressLines : (isMassair ? [...COMPANY.addressLines.slice(0, 1), COMPANY.addressLines.slice(1).join(" ")] : []),
    phone: i.tel || (isMassair ? COMPANY.tel : ""),
    whatsapp: i.whatsapp,
    email: i.email,
    web: i.web,
    banking,
    signatory: signatory || (isMassair ? "Johan Botha" : ""),
  };
}

export async function loadIssuingCompany(signatory?: string | null): Promise<AgreementCompany> {
  const profiles = await fetchCompanyProfiles().catch(() => [] as CompanyProfile[]);
  const p = profiles.find((x) => x.is_default) || profiles[0] || null;
  const company = agreementCompanyFromProfile(p, signatory);
  const isMassair = !p || p.company_id === COMPANY.companyId;
  const logoSrc = p?.logo_url?.trim() || (isMassair ? massairLogo : "");
  company.logoDataUrl = logoSrc ? await toDataUrl(logoSrc) : null;
  return company;
}
