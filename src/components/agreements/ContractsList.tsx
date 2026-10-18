import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Download, FileSignature, Loader2, Plus } from "lucide-react";
import { downloadContractPdf, frequencyLabel, getAgreementContract, listAgreementContracts } from "@/lib/agreementTemplates/contracts";
import ContractEditorDialog from "./ContractEditorDialog";
import CreateContractDialog, { type ContractSourceOption } from "./CreateContractDialog";

const STATUS_CLS: Record<string, string> = { draft: "bg-orange-500", issued: "bg-blue-500", signed: "bg-green-600", void: "bg-gray-500" };

/** Service contracts list: all of the company's contracts, or one client's (with a Create button). */
export default function ContractsList({ customerId, customerName, invoiceOptions, jobOptions, createSignal = 0 }: {
  customerId?: string; customerName?: string; invoiceOptions?: ContractSourceOption[]; jobOptions?: ContractSourceOption[];
  /** Bump to open the Create dialog from outside (e.g. the client page's Create New menu). */
  createSignal?: number;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = ["agreement-contracts", customerId || "all"];
  const { data = [], isLoading, error } = useQuery({ queryKey: key, queryFn: () => listAgreementContracts(customerId) });
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  useEffect(() => { if (createSignal > 0 && customerId) setCreating(true); }, [createSignal, customerId]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["agreement-contracts"] });

  return (
    <div className="space-y-3 p-3 md:p-4" data-testid="contracts-list">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">Service contracts{customerName ? ` for ${customerName}` : ""}. Creating one never starts an agreement, job or reminder.</p>
        {customerId && (
          <Button size="sm" onClick={() => setCreating(true)} data-testid="create-service-contract"><Plus className="mr-1 h-4 w-4" /> Create service contract</Button>
        )}
      </div>
      {isLoading ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : error ? (
        <p className="text-sm text-destructive">{(error as Error).message}</p>
      ) : data.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground"><FileSignature className="mx-auto mb-2 h-8 w-8 opacity-50" />No service contracts yet.</Card>
      ) : (
        <div className="space-y-2">
          {data.map((c) => (
            <Card key={c.id} className="flex flex-wrap items-center gap-2 p-3">
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen(c.id)}>
                <p className="text-sm font-semibold text-primary">{c.contract_number}{!customerId && c.customers?.name ? ` · ${c.customers.name}` : ""}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {c.template_name || "Contract"} · {frequencyLabel(c.frequency)}{c.start_date ? ` · from ${format(new Date(`${c.start_date}T00:00:00`), "dd MMM yyyy")}` : ""}
                  {c.source_invoice_ids.length ? ` · ${c.source_invoice_ids.length} invoice${c.source_invoice_ids.length === 1 ? "" : "s"}` : ""}
                </p>
              </button>
              <Badge className={`${STATUS_CLS[c.status] || "bg-gray-500"} text-white`}>{c.status}</Badge>
              <Button size="sm" variant="outline" onClick={() => getAgreementContract(c.id).then((full) => downloadContractPdf(full)).catch((e) => toast({ title: "PDF failed", description: e.message, variant: "destructive" }))}>
                <Download className="mr-1 h-3.5 w-3.5" /> PDF
              </Button>
            </Card>
          ))}
        </div>
      )}
      {customerId && (
        <CreateContractDialog open={creating} onOpenChange={setCreating} customerId={customerId} customerName={customerName}
          invoiceOptions={invoiceOptions} jobOptions={jobOptions} onCreated={(id) => { refresh(); setOpen(id); }} />
      )}
      {open && <ContractEditorDialog contractId={open} onClose={() => setOpen(null)} onSaved={refresh} />}
    </div>
  );
}
