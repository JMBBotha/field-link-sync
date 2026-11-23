import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { fetchCompanyProfiles, type CompanyProfile } from "@/lib/companyProfiles";
import { buildPurchaseOrderPdf, type PoRow } from "@/lib/purchaseOrderPdf";
import {
  parseEmailList,
  poIssuerName,
  poIssuerProfile,
  previewFromRpc,
  supplierEmailsToSave,
  type PoDraftView,
} from "@/lib/jobPurchaseOrder";

function toPoRow(draft: PoDraftView, emails: string[]): PoRow {
  return {
    id: draft.id,
    po_number: draft.poNumber,
    status: draft.status,
    created_at: draft.createdAt || new Date().toISOString(),
    client_name: draft.clientName,
    job_reference: draft.jobReference,
    supplier_account_number: draft.accountNumber,
    supplier_emails: emails,
    deliver_to: null,
    subtotal: draft.subtotal,
    vat_amount: draft.vat,
    total: draft.total,
    supplier: { name: draft.supplierName, main_phone: null },
    items: draft.lines.map((line) => ({
      model_code: line.code,
      description: line.description,
      qty: line.qty,
      unit_cost_excl_vat: line.unitCost,
      line_total_excl_vat: line.lineTotal,
    })),
  };
}

/** Opens a draft, saves typed supplier emails, then sends only when Send PO is pressed. */
export function useUnitPurchaseOrder() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<PoDraftView[] | null>(null);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [missingPrice, setMissingPrice] = useState<string[]>([]);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [companyName, setCompanyName] = useState(poIssuerName(null));
  const [profile, setProfile] = useState<CompanyProfile | null>(null);

  const close = () => {
    setDrafts(null);
    setMissingPrice([]);
  };

  const refresh = (jobId: string) => {
    qc.invalidateQueries({ queryKey: ["role-week-stock"] });
    qc.invalidateQueries({ queryKey: ["job-unit-pos", jobId] });
  };

  const open = async (jobId: string) => {
    setBusyJobId(jobId);
    const { data, error } = await (supabase as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
    }).rpc("create_draft_pos_for_job", { p_job: jobId });
    setBusyJobId(null);
    if (error) {
      toast({ title: "No purchase order", description: error.message, variant: "destructive" });
      return;
    }
    const parsed = previewFromRpc(data);
    const profiles = await fetchCompanyProfiles().catch(() => [] as CompanyProfile[]);
    const record = profiles.find((item) => item.is_default) || profiles[0] || null;
    setProfile(record);
    setCompanyName(poIssuerName(record?.legal_name));
    if (!parsed.drafts.length) {
      const ordered = parsed.ordered[0];
      toast({
        title: ordered ? `Ordered · ${ordered.poNumber}` : "Nothing new to order",
        description: parsed.missingPrice.length
          ? `No catalogue price for ${parsed.missingPrice.map((item) => item.code || item.description).join(", ")}.`
          : ordered ? "This shortage is already on a purchase order." : undefined,
      });
      refresh(jobId);
      return;
    }
    setDrafts(parsed.drafts);
    setEmails(Object.fromEntries(parsed.drafts.map((draft) => [draft.id, draft.emails.join(", ")])));
    setMissingPrice(parsed.missingPrice.map((item) => item.code || item.description));
  };

  const send = async () => {
    if (!drafts?.length || sending) return;
    for (const draft of drafts) {
      const parsed = parseEmailList(emails[draft.id] || "");
      if (parsed.invalid.length || parsed.emails.length === 0) {
        toast({ title: "Check the supplier email", description: parsed.invalid[0] || "Type at least one address.", variant: "destructive" });
        return;
      }
    }
    setSending(true);
    try {
      for (const draft of drafts) {
        const parsed = parseEmailList(emails[draft.id] || "");
        const saved = supplierEmailsToSave(draft.emails, parsed.emails);
        const save = await (supabase as unknown as {
          rpc: (fn: string, args: Record<string, unknown>) => Promise<{ error: { message?: string } | null }>;
        }).rpc("set_supplier_order_emails", { p_po: draft.id, p_emails: saved });
        if (save.error) throw new Error(save.error.message || "Could not save the supplier email");
        const pdf = buildPurchaseOrderPdf(toPoRow(draft, saved), poIssuerProfile(profile)).output("datauristring");
        const content = pdf.includes(",") ? pdf.split(",")[1] : pdf;
        const sent = await supabase.functions.invoke("send-purchase-order", {
          body: { po_id: draft.id, file_attachments: [{ filename: `${draft.poNumber}.pdf`, content }] },
        });
        if (sent.error) throw new Error(sent.error.message || "The email was not sent");
        const body = sent.data as { error?: string } | null;
        if (body?.error) throw new Error(body.error);
      }
      toast({ title: drafts.length === 1 ? `Ordered · ${drafts[0].poNumber}` : "Purchase orders sent" });
      close();
      qc.invalidateQueries({ queryKey: ["role-week-stock"] });
      qc.invalidateQueries({ queryKey: ["job-unit-pos"] });
    } catch (error) {
      toast({ title: "Not sent", description: error instanceof Error ? error.message : "Try again.", variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return { drafts, emails, setEmails, missingPrice, busyJobId, sending, companyName, open, close, send };
}
