import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useRole } from "@/hooks/useRole";
import { useIsMainCompany } from "@/hooks/useIsMainCompany";
import { COMPANY } from "@/lib/companyIdentity";
import { ArrowDown, ArrowUp, Download, Eye, FileText, History, Loader2, Pencil, Plus, Save, Trash2, Upload } from "lucide-react";
import {
  addSection, docSections, FIELD_HELP, moveSection, removeSection, toSavePayload,
  type DocKind, type SectionKind, type TemplateSection,
} from "@/lib/agreementTemplates/markup";
import { buildAgreementPdf } from "@/lib/agreementTemplates/pdf";
import {
  createAgreementTemplate, FILE_LABELS, getTemplateSections, listAgreementTemplates, listTemplateVersions,
  loadIssuingCompany, saveAgreementTemplate, signedTemplateFileUrl, uploadTemplateFile,
  type AgreementTemplate, type TemplateFileKey, type TemplateStatus, type TemplateVersion,
} from "@/lib/agreementTemplates/api";
import AgreementSectionPreview from "./AgreementSectionPreview";
import { downloadTemplatePdf, sectionChip, useAgreementTemplates } from "./templateActions";

const errText = (e: unknown) => (e instanceof Error ? e.message : (e as { message?: string })?.message || String(e));

const STATUS: Record<TemplateStatus, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-orange-500" },
  active: { label: "Active", cls: "bg-green-600" },
  archived: { label: "Archived", cls: "bg-gray-500" },
};

const FILE_KEYS: TemplateFileKey[] = ["contract_pdf_path", "contract_docx_path", "sla_docx_path", "sla_pdf_path"];

async function openFile(path: string, name?: string) {
  const w = window.open("", "_blank");
  try {
    const url = await signedTemplateFileUrl(path, name);
    if (w) w.location.href = url; else window.location.href = url;
  } catch (e) {
    w?.close();
    throw e;
  }
}

export default function AgreementTemplatesTab() {
  const { isAdmin } = useRole();
  const { isMain } = useIsMainCompany();
  const canManage = isAdmin && isMain;
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: templates = [], isLoading, error } = useAgreementTemplates();
  const [open, setOpen] = useState<AgreementTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try { await fn(); } catch (e: unknown) {
      toast({ title: "Something went wrong", description: errText(e), variant: "destructive" });
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-4" data-testid="agreement-templates-tab">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {canManage
            ? "Service contract and SLA templates. Edit the wording here; every save keeps the previous version."
            : "Service contract and SLA templates set by the main company. Read-only here; PDFs use your own company details."}
        </p>
        {canManage && (
          <Button size="sm" onClick={() => { setNewName(""); setCreating(true); }} data-testid="new-template">
            <Plus className="mr-1 h-4 w-4" /> New template
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : error ? (
        <Card className="p-6 text-sm text-destructive">Could not load templates: {(error as Error).message}</Card>
      ) : templates.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          <FileText className="mx-auto mb-2 h-10 w-10 opacity-50" />
          No templates available yet.
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((t) => (
            <Card key={t.id} data-testid="agreement-template-card" className="flex flex-col">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base leading-snug">{t.name}</CardTitle>
                    <CardDescription>{t.tier || "No tier"} · v{t.version}</CardDescription>
                  </div>
                  <Badge className={`${STATUS[t.status].cls} shrink-0 text-white`}>{STATUS[t.status].label}</Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-3">
                {t.description && <p className="line-clamp-4 text-xs text-muted-foreground" title={t.description}>{t.description}</p>}
                <div className="mt-auto flex flex-wrap gap-2">
                  <Button size="sm" variant="default" onClick={() => setOpen(t)} data-testid="open-template">
                    {canManage ? <><Pencil className="mr-1 h-3.5 w-3.5" /> Edit</> : <><Eye className="mr-1 h-3.5 w-3.5" /> View</>}
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy === `pdf-${t.id}`} onClick={() => run(`pdf-${t.id}`, () => downloadTemplatePdf(t))} data-testid="template-pdf">
                    {busy === `pdf-${t.id}` ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />} Client PDF
                  </Button>
                </div>
                {FILE_KEYS.some((k) => t[k]) && (
                  <div className="flex flex-wrap gap-x-3 gap-y-1 border-t pt-2 text-xs">
                    <span className="text-muted-foreground">Original files:</span>
                    {FILE_KEYS.filter((k) => t[k]).map((k) => (
                      <button key={k} type="button" className="text-primary underline-offset-2 hover:underline" data-testid={`file-${k}`}
                        onClick={() => run(`f-${k}`, () => openFile(t[k]!))}>{FILE_LABELS[k]}</button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New agreement template</DialogTitle>
            <DialogDescription>Starts as a draft with a parties clause and signatures. Drafts are not shown to other companies.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="tpl-name">Name</Label>
            <Input id="tpl-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Service Contract & SLA - Commercial (Tier 2)" />
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => setCreating(false)}>Cancel</Button>
            <Button className="flex-1" disabled={!newName.trim() || busy === "create"} onClick={() => run("create", async () => {
              const t = await createAgreementTemplate(COMPANY.companyId, newName.trim(), null);
              await qc.invalidateQueries({ queryKey: ["agreement-templates"] });
              setCreating(false); setOpen(t);
            })}>Create</Button>
          </div>
        </DialogContent>
      </Dialog>

      {open && (
        <TemplateEditorDialog template={open} canManage={canManage} onClose={() => setOpen(null)}
          onSaved={async () => { await qc.invalidateQueries({ queryKey: ["agreement-templates"] }); }} />
      )}
    </div>
  );
}

function TemplateEditorDialog({ template, canManage, onClose, onSaved }: {
  template: AgreementTemplate; canManage: boolean; onClose: () => void; onSaved: () => Promise<void> | void;
}) {
  const { toast } = useToast();
  const [t, setT] = useState(template);
  const [sections, setSections] = useState<TemplateSection[] | null>(null);
  const [meta, setMeta] = useState({ name: template.name, tier: template.tier || "", description: template.description || "", status: template.status });
  const [doc, setDoc] = useState<DocKind>("contract");
  const [mode, setMode] = useState<"edit" | "preview">(canManage ? "edit" : "preview");
  const [dirty, setDirty] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [versions, setVersions] = useState<TemplateVersion[] | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const [uploading, setUploading] = useState<TemplateFileKey | null>(null);

  const load = useCallback(async () => {
    setSections(await getTemplateSections(template.id));
  }, [template.id]);
  useEffect(() => { load().catch((e) => toast({ title: "Could not load template", description: e.message, variant: "destructive" })); }, [load, toast]);

  const list = useMemo(() => (sections ? docSections(sections, doc) : []), [sections, doc]);
  const change = (next: TemplateSection[]) => { setSections(next); setDirty(true); };
  const patch = (index: number, p: Partial<TemplateSection>) => {
    if (!sections) return;
    const target = list[index];
    change(sections.map((s) => (s.doc_kind === target.doc_kind && s.position === target.position ? { ...s, ...p } : s)));
  };

  const save = async () => {
    if (!sections) return;
    setSaving(true);
    try {
      const v = await saveAgreementTemplate(t.id, { name: meta.name.trim() || t.name, tier: meta.tier.trim() || null, description: meta.description, status: meta.status }, toSavePayload(sections), note);
      setT({ ...t, version: v, name: meta.name.trim() || t.name, tier: meta.tier.trim() || null, description: meta.description, status: meta.status });
      setDirty(false); setNote(""); setVersions(null);
      await load();
      await onSaved();
      toast({ title: `Saved as version ${v}`, description: "The previous version is kept in History." });
    } catch (e: unknown) {
      toast({ title: "Not saved", description: errText(e), variant: "destructive" });
    } finally { setSaving(false); }
  };

  const openVersions = async () => {
    setShowVersions(true);
    if (!versions) {
      try { setVersions(await listTemplateVersions(t.id)); } catch (e: unknown) { toast({ title: "Could not load history", description: errText(e), variant: "destructive" }); }
    }
  };

  const restore = (v: TemplateVersion) => {
    setSections(v.snapshot.sections.map((s) => ({ ...s })));
    setMeta({ name: v.snapshot.name, tier: v.snapshot.tier || "", description: v.snapshot.description || "", status: v.snapshot.status });
    setDirty(true); setNote(`Restored from version ${v.version}`); setShowVersions(false);
    toast({ title: `Version ${v.version} loaded`, description: "Review it, then Save to make it the current version." });
  };

  const upload = async (key: TemplateFileKey, file: File | undefined) => {
    if (!file) return;
    setUploading(key);
    try {
      const path = await uploadTemplateFile(t, key, file);
      setT({ ...t, [key]: path });
      await onSaved();
      toast({ title: "File uploaded", description: FILE_LABELS[key] });
    } catch (e: unknown) {
      toast({ title: "Upload failed", description: errText(e), variant: "destructive" });
    } finally { setUploading(null); }
  };

  const close = () => {
    if (dirty && !window.confirm("You have unsaved changes. Close without saving?")) return;
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-full max-w-5xl flex-col gap-0 overflow-hidden p-0 sm:h-[92vh] sm:rounded-lg" data-testid="template-editor">
        <DialogHeader className="border-b px-4 py-3 text-left">
          <DialogTitle className="pr-8 text-base">{t.name}</DialogTitle>
          <DialogDescription>
            {STATUS[meta.status].label} · version {t.version}{dirty ? " · unsaved changes" : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
          <Tabs value={doc} onValueChange={(v) => setDoc(v as DocKind)}>
            <TabsList>
              <TabsTrigger value="contract" data-testid="doc-contract">Contract</TabsTrigger>
              <TabsTrigger value="sla" data-testid="doc-sla">SLA (Schedule B)</TabsTrigger>
            </TabsList>
          </Tabs>
          {canManage && (
            <Tabs value={mode} onValueChange={(v) => setMode(v as "edit" | "preview")}>
              <TabsList>
                <TabsTrigger value="edit">Edit</TabsTrigger>
                <TabsTrigger value="preview">Preview</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={openVersions} data-testid="template-history"><History className="mr-1 h-3.5 w-3.5" /> History</Button>
            <Button size="sm" variant="outline" disabled={!sections} onClick={() => downloadTemplatePdf({ ...t, status: meta.status }, sections || undefined).catch((e: unknown) => toast({ title: "PDF failed", description: errText(e), variant: "destructive" }))}>
              <Download className="mr-1 h-3.5 w-3.5" /> PDF
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {!sections ? (
            <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-4">
              {canManage && mode === "edit" && doc === "contract" && (
                <Card className="space-y-3 p-3">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1 sm:col-span-2"><Label>Name</Label><Input value={meta.name} onChange={(e) => { setMeta({ ...meta, name: e.target.value }); setDirty(true); }} /></div>
                    <div className="space-y-1"><Label>Status</Label>
                      <Select value={meta.status} onValueChange={(v) => { setMeta({ ...meta, status: v as TemplateStatus }); setDirty(true); }}>
                        <SelectTrigger data-testid="template-status"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="draft">Draft (main company only)</SelectItem>
                          <SelectItem value="active">Active (all companies)</SelectItem>
                          <SelectItem value="archived">Archived</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1"><Label>Tier</Label><Input value={meta.tier} onChange={(e) => { setMeta({ ...meta, tier: e.target.value }); setDirty(true); }} placeholder="e.g. Basic (Tier 1)" /></div>
                    <div className="space-y-1 sm:col-span-2"><Label>Description / internal notes</Label><Textarea rows={3} value={meta.description} onChange={(e) => { setMeta({ ...meta, description: e.target.value }); setDirty(true); }} /></div>
                  </div>
                  <div className="space-y-1 border-t pt-2">
                    <p className="text-xs font-medium">Original files (optional, private)</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {FILE_KEYS.map((k) => (
                        <div key={k} className="flex items-center gap-2 text-xs">
                          <span className="min-w-0 flex-1 truncate">{FILE_LABELS[k]}{t[k] ? "" : " — none"}</span>
                          {t[k] && <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => signedTemplateFileUrl(t[k]!).then((u) => window.open(u, "_blank"))}><Eye className="h-3.5 w-3.5" /></Button>}
                          <label className="inline-flex h-7 cursor-pointer items-center rounded-md border px-2 hover:bg-muted">
                            {uploading === k ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                            <input type="file" className="hidden" accept={k.includes("pdf") ? "application/pdf" : ".doc,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"}
                              onChange={(e) => { upload(k, e.target.files?.[0]); e.currentTarget.value = ""; }} />
                          </label>
                        </div>
                      ))}
                    </div>
                  </div>
                </Card>
              )}

              {canManage && mode === "edit" && (
                <details className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
                  <summary className="cursor-pointer font-medium">How to write clauses</summary>
                  <ul className="mt-2 list-disc space-y-0.5 pl-4 text-muted-foreground">
                    <li>One line per clause: start with its number, e.g. <code>2.1 We will…</code></li>
                    <li><code>- text</code> for a bullet, <code>**bold**</code> for bold, <code>| a | b |</code> lines for a table (first row = header).</li>
                    <li>Company details fill in on the PDF: {FIELD_HELP.map((f) => <code key={f.key} className="mr-1" title={f.label}>{`{{${f.key}}}`}</code>)}</li>
                  </ul>
                </details>
              )}

              {list.map((s, i) => (canManage && mode === "edit") ? (
                <Card key={`${s.doc_kind}-${i}`} className="space-y-2 p-3" data-testid="template-section-editor">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1AA7EC] text-[10px] font-bold text-white">{sectionChip(s, i)}</span>
                    <Input value={s.heading} onChange={(e) => patch(i, { heading: e.target.value })} className="h-8 font-semibold" aria-label="Section heading" />
                    <div className="flex shrink-0">
                      <Button size="icon" variant="ghost" className="h-8 w-8" disabled={i === 0} onClick={() => change(moveSection(sections, doc, i, -1))} aria-label="Move up"><ArrowUp className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8" disabled={i === list.length - 1} onClick={() => change(moveSection(sections, doc, i, 1))} aria-label="Move down"><ArrowDown className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" onClick={() => { if (window.confirm(`Remove "${s.heading}"?`)) change(removeSection(sections, doc, i)); }} aria-label="Remove section"><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </div>
                  <Textarea value={s.body} onChange={(e) => patch(i, { body: e.target.value })} rows={Math.min(18, Math.max(3, s.body.split("\n").length + 1))} className="font-mono text-[12px] leading-relaxed" aria-label="Section text" />
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={s.kind} onValueChange={(v) => patch(i, { kind: v as SectionKind })}>
                      <SelectTrigger className="h-7 w-auto text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="text">Clauses</SelectItem>
                        <SelectItem value="signatures">Signature boxes</SelectItem>
                        <SelectItem value="units">Covered-units register</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => change(addSection(sections, doc, i))}><Plus className="mr-1 h-3.5 w-3.5" /> Add section below</Button>
                  </div>
                </Card>
              ) : (
                <AgreementSectionPreview key={`${s.doc_kind}-${i}`} section={s} chip={sectionChip(s, i)} />
              ))}
              {canManage && mode === "edit" && (
                <Button variant="outline" className="w-full border-dashed" onClick={() => change(addSection(sections, doc))}><Plus className="mr-1 h-4 w-4" /> Add section</Button>
              )}
              {list.length === 0 && <p className="text-center text-sm text-muted-foreground">No sections in this document yet.</p>}
            </div>
          )}
        </div>

        {canManage && (
          <div className="flex flex-col gap-2 border-t px-4 py-3 sm:flex-row sm:items-center">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What changed? (optional, kept in History)" className="h-9 sm:flex-1" />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 sm:flex-none" onClick={close}>Close</Button>
              <Button className="flex-1 sm:flex-none" disabled={!dirty || saving || !sections} onClick={save} data-testid="template-save">
                {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />} Save version {t.version + 1}
              </Button>
            </div>
          </div>
        )}

        <Dialog open={showVersions} onOpenChange={setShowVersions}>
          <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Version history</DialogTitle>
              <DialogDescription>Every save is kept. Load an older version into the editor, then save it to make it current.</DialogDescription>
            </DialogHeader>
            {!versions ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : (
              <div className="space-y-2">
                {versions.map((v) => (
                  <div key={v.id} className="flex items-center gap-2 rounded-md border p-2 text-sm" data-testid="template-version">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">Version {v.version}{v.version === t.version ? " (current)" : ""}</p>
                      <p className="truncate text-xs text-muted-foreground">{new Date(v.created_at).toLocaleString("en-ZA")} · {v.note || "No note"}</p>
                    </div>
                    {canManage && v.version !== t.version && <Button size="sm" variant="outline" onClick={() => restore(v)}>Load</Button>}
                  </div>
                ))}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
