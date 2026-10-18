import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { ArrowDown, ArrowUp, Download, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { addSection, docSections, moveSection, removeSection, toSavePayload, type DocKind, type TemplateSection } from "@/lib/agreementTemplates/markup";
import type { AgreementClient, AgreementUnitRow } from "@/lib/agreementTemplates/pdf";
import {
  contractFields, downloadContractPdf, FREQUENCY_OPTIONS, getAgreementContract, updateAgreementContract,
  type AgreementContract, type ContractStatus,
} from "@/lib/agreementTemplates/contracts";
import AgreementSectionPreview from "./AgreementSectionPreview";
import { sectionChip } from "./templateActions";

const errText = (e: unknown) => (e instanceof Error ? e.message : (e as { message?: string })?.message || String(e));

const CLIENT_FIELDS: [keyof AgreementClient, string][] = [
  ["name", "Client name"], ["legalName", "Company / legal name"], ["regNo", "Reg. no."], ["vat", "VAT number"],
  ["contact", "Contact person"], ["phone", "Phone / WhatsApp"], ["email", "Email"],
  ["postalAddress", "Postal address"], ["siteAddress", "Site address(es)"],
];
const UNIT_FIELDS: [keyof AgreementUnitRow, string, string][] = [
  ["location", "Location / room", "sm:col-span-2"], ["type", "Type", ""], ["model", "Brand and model", "sm:col-span-2"],
  ["serial", "Serial no.", ""], ["size", "BTU", ""], ["installDate", "Install date", ""], ["byUs", "By us (Y/N)", ""], ["ref", "Invoice / job", ""],
];

/** Edit one contract instance (client details, units, wording). Edits never touch the template. */
export default function ContractEditorDialog({ contractId, onClose, onSaved }: { contractId: string; onClose: () => void; onSaved?: () => void }) {
  const { toast } = useToast();
  const [c, setC] = useState<AgreementContract | null>(null);
  const [tab, setTab] = useState<"details" | "units" | "contract" | "sla">("details");
  const [preview, setPreview] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { getAgreementContract(contractId).then(setC).catch((e) => toast({ title: "Could not open contract", description: errText(e), variant: "destructive" })); }, [contractId, toast]);

  const set = (p: Partial<AgreementContract>) => { setC((x) => (x ? { ...x, ...p } : x)); setDirty(true); };
  const fields = useMemo(() => (c ? contractFields(c) : {}), [c]);
  const doc: DocKind = tab === "sla" ? "sla" : "contract";
  const list = c ? docSections(c.sections, doc) : [];
  const patchSection = (i: number, p: Partial<TemplateSection>) => {
    if (!c) return;
    const t = list[i];
    set({ sections: c.sections.map((s) => (s.doc_kind === t.doc_kind && s.position === t.position ? { ...s, ...p } : s)) });
  };

  const save = async () => {
    if (!c) return;
    setSaving(true);
    try {
      await updateAgreementContract(c.id, {
        title: c.title, status: c.status, start_date: c.start_date, frequency: c.frequency, client_snapshot: c.client_snapshot,
        units: c.units, sections: toSavePayload(c.sections), notes: c.notes,
      });
      setDirty(false); onSaved?.();
      toast({ title: "Contract saved" });
    } catch (e) { toast({ title: "Not saved", description: errText(e), variant: "destructive" }); } finally { setSaving(false); }
  };
  const close = () => { if (dirty && !window.confirm("You have unsaved changes. Close without saving?")) return; onClose(); };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-full max-w-4xl flex-col gap-0 overflow-hidden p-0 sm:h-[92vh] sm:rounded-lg" data-testid="contract-editor">
        <DialogHeader className="border-b px-4 py-3 text-left">
          <DialogTitle className="pr-8 text-base">{c ? `${c.contract_number} · ${c.client_snapshot?.name || "Client"}` : "Contract"}</DialogTitle>
          <DialogDescription>{c ? `From ${c.template_name || "template"}${c.template_version ? ` v${c.template_version}` : ""} · ${c.status}${dirty ? " · unsaved changes" : ""}` : "Loading…"}</DialogDescription>
        </DialogHeader>
        {!c ? <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div> : (<>
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
            <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
              <TabsList>
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="units" data-testid="contract-units-tab">Units ({c.units.length})</TabsTrigger>
                <TabsTrigger value="contract">Contract</TabsTrigger>
                <TabsTrigger value="sla">SLA</TabsTrigger>
              </TabsList>
            </Tabs>
            {(tab === "contract" || tab === "sla") && (
              <Button size="sm" variant="outline" onClick={() => setPreview((p) => !p)}>{preview ? "Edit" : "Preview"}</Button>
            )}
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => downloadContractPdf(c).catch((e) => toast({ title: "PDF failed", description: errText(e), variant: "destructive" }))} data-testid="contract-pdf">
              <Download className="mr-1 h-3.5 w-3.5" /> PDF
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <div className="mx-auto max-w-3xl space-y-3">
              {tab === "details" && (<>
                <Card className="grid gap-3 p-3 sm:grid-cols-3">
                  <div className="space-y-1"><Label>Status</Label>
                    <Select value={c.status} onValueChange={(v) => set({ status: v as ContractStatus })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">Draft</SelectItem><SelectItem value="issued">Issued to client</SelectItem>
                        <SelectItem value="signed">Signed</SelectItem><SelectItem value="void">Void</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1"><Label>Start date</Label><Input type="date" value={c.start_date || ""} onChange={(e) => set({ start_date: e.target.value || null })} /></div>
                  <div className="space-y-1"><Label>Frequency</Label>
                    <Select value={c.frequency || "annual"} onValueChange={(v) => set({ frequency: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{FREQUENCY_OPTIONS.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </Card>
                <Card className="grid gap-3 p-3 sm:grid-cols-2">
                  <p className="text-xs text-muted-foreground sm:col-span-2">Filled in from the client record. Changes here apply to this contract only.</p>
                  {CLIENT_FIELDS.map(([k, label]) => (
                    <div key={k} className={`space-y-1 ${k === "siteAddress" || k === "postalAddress" ? "sm:col-span-2" : ""}`}>
                      <Label>{label}</Label>
                      <Input value={(c.client_snapshot?.[k] as string) || ""} data-testid={`client-${k}`} onChange={(e) => set({ client_snapshot: { ...c.client_snapshot, [k]: e.target.value } })} />
                    </div>
                  ))}
                  <div className="space-y-1 sm:col-span-2"><Label>Internal notes</Label><Textarea rows={2} value={c.notes || ""} onChange={(e) => set({ notes: e.target.value })} /></div>
                </Card>
              </>)}

              {tab === "units" && (<>
                {c.units.map((u, i) => (
                  <Card key={i} className="space-y-2 p-3" data-testid="contract-unit">
                    <div className="flex items-center justify-between"><span className="text-sm font-semibold">Unit {i + 1}</span>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" aria-label="Remove unit" onClick={() => set({ units: c.units.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-4">
                      {UNIT_FIELDS.map(([k, label, span]) => (
                        <div key={k} className={`space-y-0.5 ${span}`}><Label className="text-xs">{label}</Label>
                          <Input className="h-8" value={u[k] || ""} onChange={(e) => set({ units: c.units.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)) })} /></div>
                      ))}
                    </div>
                  </Card>
                ))}
                {c.units.length === 0 && <p className="text-center text-sm text-muted-foreground">No units yet. The PDF shows a blank register to fill in by hand.</p>}
                <Button variant="outline" className="w-full border-dashed" onClick={() => set({ units: [...c.units, { byUs: "" }] })}><Plus className="mr-1 h-4 w-4" /> Add unit</Button>
              </>)}

              {(tab === "contract" || tab === "sla") && (<>
                {list.map((s, i) => preview ? (
                  <AgreementSectionPreview key={i} section={s} chip={sectionChip(s, i)} fields={fields} />
                ) : (
                  <Card key={i} className="space-y-2 p-3">
                    <div className="flex items-center gap-2">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1AA7EC] text-xs font-bold text-white">{sectionChip(s, i)}</span>
                      <Input value={s.heading} onChange={(e) => patchSection(i, { heading: e.target.value })} className="h-8 font-semibold" aria-label="Section heading" />
                      <Button size="icon" variant="ghost" className="h-8 w-8" disabled={i === 0} onClick={() => set({ sections: moveSection(c.sections, doc, i, -1) })} aria-label="Move up"><ArrowUp className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" disabled={i === list.length - 1} onClick={() => set({ sections: moveSection(c.sections, doc, i, 1) })} aria-label="Move down"><ArrowDown className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => { if (window.confirm(`Remove "${s.heading}" from this contract?`)) set({ sections: removeSection(c.sections, doc, i) }); }} aria-label="Remove section"><Trash2 className="h-4 w-4" /></Button>
                    </div>
                    <Textarea value={s.body} onChange={(e) => patchSection(i, { body: e.target.value })} rows={Math.min(16, Math.max(3, s.body.split("\n").length + 1))} className="font-mono text-xs" aria-label="Section text" />
                  </Card>
                ))}
                {!preview && <Button variant="outline" className="w-full border-dashed" onClick={() => set({ sections: addSection(c.sections, doc) })}><Plus className="mr-1 h-4 w-4" /> Add section</Button>}
              </>)}
            </div>
          </div>
          <div className="flex gap-2 border-t px-4 py-3">
            <p className="hidden flex-1 self-center text-xs text-muted-foreground sm:block">Edits here change this contract only, never the template.</p>
            <Button variant="outline" className="flex-1 sm:flex-none" onClick={close}>Close</Button>
            <Button className="flex-1 sm:flex-none" disabled={!dirty || saving} onClick={save} data-testid="contract-save">
              {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />} Save
            </Button>
          </div>
        </>)}
      </DialogContent>
    </Dialog>
  );
}
