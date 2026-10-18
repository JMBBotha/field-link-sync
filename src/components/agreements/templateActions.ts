import { useQuery } from "@tanstack/react-query";
import type { TemplateSection } from "@/lib/agreementTemplates/markup";
import { buildAgreementPdf } from "@/lib/agreementTemplates/pdf";
import { getTemplateSections, listAgreementTemplates, loadIssuingCompany, type AgreementTemplate } from "@/lib/agreementTemplates/api";

export const sectionChip = (s: TemplateSection, index: number) =>
  s.kind === "units" ? "A" : `${s.doc_kind === "sla" ? "B" : ""}${String(index + 1).padStart(2, "0")}`;

export function useAgreementTemplates() {
  return useQuery({ queryKey: ["agreement-templates"], queryFn: listAgreementTemplates, staleTime: 30_000 });
}

export async function downloadTemplatePdf(t: AgreementTemplate, sections?: TemplateSection[]) {
  const secs = sections || (await getTemplateSections(t.id));
  const company = await loadIssuingCompany();
  const doc = buildAgreementPdf({ title: "Service contract", draft: t.status !== "active", sections: secs, company });
  doc.save(`${t.name.replace(/[^\w&() -]+/g, "").trim() || "Service contract"} v${t.version}.pdf`);
}

