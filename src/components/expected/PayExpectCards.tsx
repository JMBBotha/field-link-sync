import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useRole } from "@/hooks/useRole";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { supabase } from "@/integrations/supabase/client";
import { payExpectSettings, type PayExpectSettings, type ProjectExpectOverride } from "@/lib/expectedPayDates";
import { savePayExpectDefaults, savePayExpectInvoice, savePayExpectProject } from "@/lib/payExpectApi";
import { InvoiceExpectForm, PayExpectSettingsForm, ProjectExpectForm } from "./PayExpectForms";

const db = supabase as unknown as {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (col: string, value: string) => {
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { message?: string } | null }>;
      };
    };
  };
};

function useAdminOnly() {
  const { isAdmin } = useRole();
  return isAdmin;
}

export function PayExpectSettingsCard() {
  const admin = useAdminOnly();
  const { companyId } = useUserCompanyId() as { companyId?: string | null };
  const { toast } = useToast();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["pay-expect-defaults", companyId],
    enabled: admin && !!companyId,
    queryFn: async () => {
      const { data, error } = await db.from("pay_expect_defaults").select("project_deposit_days, project_final_days, window_extra_days, normal_deposit_days, normal_final_days, late_grace_days").eq("company_id", companyId as string).maybeSingle();
      if (error) return payExpectSettings(null);
      return payExpectSettings(data ? {
        projectDepositDays: Number(data.project_deposit_days),
        projectFinalDays: Number(data.project_final_days),
        windowExtraDays: Number(data.window_extra_days),
        normalDepositDays: Number(data.normal_deposit_days),
        normalFinalDays: Number(data.normal_final_days),
        lateGraceDays: Number(data.late_grace_days),
      } : null);
    },
  });
  const [value, setValue] = useState<PayExpectSettings>(payExpectSettings(null));
  useEffect(() => { if (query.data) setValue(query.data); }, [query.data]);
  if (!admin) return null;
  return (
    <Card className="mt-4">
      <CardHeader className="pb-2"><CardTitle className="text-base">When money is expected in</CardTitle></CardHeader>
      <CardContent>
        <PayExpectSettingsForm value={value} onChange={setValue} onSave={() => {
          if (!companyId) return;
          savePayExpectDefaults(companyId, payExpectSettings(value)).then(() => {
            toast({ title: "Expected dates saved" });
            qc.invalidateQueries({ queryKey: ["pay-expect"] });
            qc.invalidateQueries({ queryKey: ["pay-expect-defaults"] });
          }).catch((err: Error) => toast({ title: "Could not save", description: err.message, variant: "destructive" }));
        }} />
      </CardContent>
    </Card>
  );
}

const emptyProject = (projectId: string): ProjectExpectOverride => ({
  projectId, timing: null, dateMode: "days_after", depositDays: null, finalDays: null, windowExtraDays: null, dayOfMonth: null, monthOffset: 0,
});

export function ProjectExpectCard({ projectId, houseCount, projectName }: { projectId: string; houseCount: number; projectName: string }) {
  const admin = useAdminOnly();
  const { toast } = useToast();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["pay-expect-project", projectId],
    enabled: admin && !!projectId,
    queryFn: async () => {
      const { data, error } = await db.from("pay_expect_project").select("timing, date_mode, deposit_days, final_days, window_extra_days, day_of_month, month_offset").eq("project_id", projectId).maybeSingle();
      if (error || !data) return emptyProject(projectId);
      return {
        projectId,
        timing: data.timing === "project" || data.timing === "normal" ? data.timing : null,
        dateMode: data.date_mode === "day_of_month" || data.date_mode === "month_end" || data.date_mode === "days_after" ? data.date_mode : "days_after",
        depositDays: data.deposit_days == null ? null : Number(data.deposit_days),
        finalDays: data.final_days == null ? null : Number(data.final_days),
        windowExtraDays: data.window_extra_days == null ? null : Number(data.window_extra_days),
        dayOfMonth: data.day_of_month == null ? null : Number(data.day_of_month),
        monthOffset: data.month_offset == null ? 0 : Number(data.month_offset),
      } as ProjectExpectOverride;
    },
  });
  const [value, setValue] = useState<ProjectExpectOverride>(emptyProject(projectId));
  useEffect(() => { if (query.data) setValue(query.data); }, [query.data]);
  if (!admin) return null;
  const hint = projectName.toUpperCase().includes("AVEC") && value.dateMode === "month_end"
    ? "AVEC is set to the last day of the invoice's own month. Johan still has to confirm that offset."
    : null;
  const save = (clear = false) => {
    savePayExpectProject({ ...value, projectId, clear }).then(() => {
      toast({ title: clear ? "Project uses automatic timing" : "Project rule saved" });
      qc.invalidateQueries({ queryKey: ["pay-expect"] });
      qc.invalidateQueries({ queryKey: ["pay-expect-project", projectId] });
    }).catch((err: Error) => toast({ title: "Could not save", description: err.message, variant: "destructive" }));
  };
  return (
    <Card data-testid="project-expect-card">
      <CardHeader className="pb-2"><CardTitle className="text-base">Expected payment dates</CardTitle></CardHeader>
      <CardContent>
        <ProjectExpectForm value={value} houseCount={houseCount} hint={hint} onChange={setValue} onSave={() => save(false)} onClear={() => { setValue(emptyProject(projectId)); save(true); }} />
      </CardContent>
    </Card>
  );
}

export function InvoiceExpectCard({ invoiceId }: { invoiceId: string }) {
  const admin = useAdminOnly();
  const { toast } = useToast();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["pay-expect-invoice", invoiceId],
    enabled: admin && !!invoiceId,
    queryFn: async () => {
      const { data } = await (supabase as unknown as { from: (t: string) => { select: (c: string) => { eq: (c: string, v: string) => Promise<{ data: { part: string; expected_on: string }[] | null }> } } })
        .from("pay_expect_invoice").select("part, expected_on").eq("invoice_id", invoiceId);
      const list = data || [];
      return {
        deposit: String(list.find((row) => row.part === "deposit")?.expected_on || "").slice(0, 10),
        finalOn: String(list.find((row) => row.part === "final")?.expected_on || "").slice(0, 10),
      };
    },
  });
  const [deposit, setDeposit] = useState("");
  const [finalOn, setFinal] = useState("");
  useEffect(() => {
    if (!query.data) return;
    setDeposit(query.data.deposit);
    setFinal(query.data.finalOn);
  }, [query.data]);
  if (!admin) return null;
  return (
    <Card className="print:hidden" data-testid="invoice-expect-card">
      <CardHeader className="pb-2"><CardTitle className="text-base">Expected payment date</CardTitle></CardHeader>
      <CardContent>
        <InvoiceExpectForm deposit={deposit} finalOn={finalOn} onDeposit={setDeposit} onFinal={setFinal} onSave={() => {
          Promise.all([
            savePayExpectInvoice(invoiceId, "deposit", deposit || null),
            savePayExpectInvoice(invoiceId, "final", finalOn || null),
          ]).then(() => {
            toast({ title: "Invoice dates saved" });
            qc.invalidateQueries({ queryKey: ["pay-expect"] });
          }).catch((err: Error) => toast({ title: "Could not save", description: err.message, variant: "destructive" }));
        }} />
      </CardContent>
    </Card>
  );
}
