import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { createAgreementContract, FREQUENCY_OPTIONS } from "@/lib/agreementTemplates/contracts";
import { useAgreementTemplates } from "./templateActions";

export interface ContractSourceOption { id: string; label: string; sub?: string }

/**
 * Create a service contract from a template for ONE client (Johan 18 Oct 2026). The server
 * (create_agreement_contract) fills in client details and the covered-units register from the
 * chosen invoices/jobs and refuses mixed clients. It never creates an agreement, job or reminder.
 */
export default function CreateContractDialog({
  open, onOpenChange, customerId, customerName, invoiceIds = [], jobIds = [], invoiceOptions, jobOptions,
  serviceAgreementId, defaultFrequency, onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  customerId: string;
  customerName?: string;
  invoiceIds?: string[];
  jobIds?: string[];
  /** When given, the user can tick which of this client's invoices / jobs feed the units register. */
  invoiceOptions?: ContractSourceOption[];
  jobOptions?: ContractSourceOption[];
  serviceAgreementId?: string | null;
  defaultFrequency?: string | null;
  onCreated: (contractId: string) => void;
}) {
  const { toast } = useToast();
  const { data: templates = [], isLoading } = useAgreementTemplates();
  const usable = useMemo(() => templates.filter((t) => t.status !== "archived"), [templates]);
  const [templateId, setTemplateId] = useState("");
  const [startDate, setStartDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [frequency, setFrequency] = useState<string>(defaultFrequency || "annual");
  const [inv, setInv] = useState<string[]>(invoiceIds);
  const [jobs, setJobs] = useState<string[]>(jobIds);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setInv(invoiceIds); setJobs(jobIds); setFrequency(defaultFrequency || "annual");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!templateId && usable.length) setTemplateId((usable.find((t) => t.status === "active") || usable[0]).id);
  }, [usable, templateId]);

  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const create = async () => {
    setBusy(true);
    try {
      const id = await createAgreementContract({ templateId, customerId, invoiceIds: inv, jobIds: jobs, startDate, frequency, serviceAgreementId });
      toast({ title: "Contract created as a draft", description: "Check the details, then download the PDF." });
      onOpenChange(false);
      onCreated(id);
    } catch (e: unknown) {
      toast({ title: "Contract not created", description: (e as { message?: string })?.message || String(e), variant: "destructive" });
    } finally { setBusy(false); }
  };

  const picked = templates.find((t) => t.id === templateId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto" data-testid="create-contract-dialog">
        <DialogHeader>
          <DialogTitle>Create service contract</DialogTitle>
          <DialogDescription>
            {customerName ? `For ${customerName}. ` : ""}Client details and covered units fill in automatically. It starts as a draft you can edit; no agreement, job or reminder is created.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Template</Label>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : usable.length === 0 ? (
              <p className="text-sm text-muted-foreground">No contract templates are available to your company yet.</p>
            ) : (
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger data-testid="contract-template"><SelectValue placeholder="Choose a template" /></SelectTrigger>
                <SelectContent>
                  {usable.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}{t.status === "draft" ? " (draft)" : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {picked?.status === "draft" && <p className="text-xs text-orange-600">This template is still a draft; the PDF will be marked DRAFT.</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Start date</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Service frequency</Label>
              <Select value={frequency} onValueChange={setFrequency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{FREQUENCY_OPTIONS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {invoiceOptions && invoiceOptions.length > 0 && (
            <SourcePicker title="Invoices (units on these fill the register)" options={invoiceOptions} selected={inv} onToggle={(id) => toggle(inv, setInv, id)} />
          )}
          {jobOptions && jobOptions.length > 0 && (
            <SourcePicker title="Jobs" options={jobOptions} selected={jobs} onToggle={(id) => toggle(jobs, setJobs, id)} />
          )}
          {!invoiceOptions && (inv.length > 0 || jobs.length > 0) && (
            <p className="text-sm text-muted-foreground">{inv.length} invoice{inv.length === 1 ? "" : "s"}{jobs.length ? ` and ${jobs.length} job${jobs.length === 1 ? "" : "s"}` : ""} selected.</p>
          )}
          {inv.length === 0 && jobs.length === 0 && (
            <p className="text-xs text-muted-foreground">No invoice or job selected: the units register uses this client's equipment list (you can edit it after).</p>
          )}
        </div>
        <div className="flex gap-2 pt-2">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="flex-1" disabled={!templateId || busy} onClick={create} data-testid="create-contract-submit">
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Create draft contract
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SourcePicker({ title, options, selected, onToggle }: { title: string; options: ContractSourceOption[]; selected: string[]; onToggle: (id: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label>{title}</Label>
      <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border p-2">
        {options.map((o) => (
          <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
            <Checkbox checked={selected.includes(o.id)} onCheckedChange={() => onToggle(o.id)} />
            <span className="min-w-0 flex-1 truncate">{o.label}</span>
            {o.sub && <span className="shrink-0 text-xs text-muted-foreground">{o.sub}</span>}
          </label>
        ))}
      </div>
    </div>
  );
}
