import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ArrowLeft,
  Plus,
  Save,
  Send,
  Eye,
  BookmarkPlus,
  LayoutTemplate,
  Paintbrush,
} from "lucide-react";
import companyLogo from "@/assets/logo.png";
import StickyActionBar, { STICKY_ACTION_BAR_SPACER } from "@/components/shared/StickyActionBar";
import CustomerSearchSelector from "@/components/customers/CustomerSearchSelector";
import ProposalSectionEditor from "@/components/proposals/visual/ProposalSectionEditor";
import VisualProposalPreview from "@/components/proposals/visual/VisualProposalPreview";
import {
  ProposalSection,
  ProposalStyle,
  ProposalTemplateStyle,
  RichTextPreset,
  RICH_PRESET_OPTIONS,
  PROPOSAL_STATUSES,
  DEFAULT_STYLE,
  THEME_COLORS,
  FONT_OPTIONS,
  richTextSection,
  pricingSection,
  attachmentsSection,
  proposalTotal,
} from "@/types/visualProposal";

const db = supabase as any;

const TEMPLATE_STYLES: { value: ProposalTemplateStyle; label: string; hint: string }[] = [
  { value: "simple", label: "Simple", hint: "Clean header with your logo" },
  { value: "modern", label: "Modern", hint: "Full-width hero image" },
  { value: "classic", label: "Classic", hint: "Centred, formal layout" },
];

const AdminProposalBuilderPage = () => {
  const [params] = useSearchParams();
  const proposalId = params.get("proposalId");
  const templateIdParam = params.get("templateId");
  const navigate = useNavigate();
  const { user } = useAuth();
  const { companyId } = useUserCompanyId();
  const { settings } = useCompanySettings() as any;
  const { toast } = useToast();
  const qc = useQueryClient();

  const [id, setId] = useState<string | null>(proposalId);
  const [title, setTitle] = useState("Untitled Proposal");
  const [reference, setReference] = useState("");
  const [proposalDate, setProposalDate] = useState(new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<string>("draft");
  const [clientId, setClientId] = useState<string | null>(null);
  const [clientName, setClientName] = useState("");
  const [sections, setSections] = useState<ProposalSection[]>([]);
  const [style, setStyle] = useState<ProposalStyle>(DEFAULT_STYLE);
  const [requireSignature, setRequireSignature] = useState(true);
  const [proposalNumber, setProposalNumber] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [templateDialog, setTemplateDialog] = useState(false);
  const [pickTemplate, setPickTemplate] = useState(!proposalId && !templateIdParam);
  const [templateName, setTemplateName] = useState("");
  const [templateDesc, setTemplateDesc] = useState("");

  const { data: templates = [] } = useQuery({
    queryKey: ["visual-proposal-templates"],
    queryFn: async () => {
      const { data, error } = await db
        .from("visual_proposal_templates")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Load existing proposal
  useEffect(() => {
    if (!proposalId) return;
    (async () => {
      const { data, error } = await db
        .from("visual_proposals")
        .select("*, customers:client_id(name)")
        .eq("id", proposalId)
        .maybeSingle();
      if (error || !data) return;
      setTitle(data.title || "Untitled Proposal");
      setStatus(data.status || "draft");
      setClientId(data.client_id);
      setClientName(data.customers?.name || "");
      setSections(Array.isArray(data.sections) ? data.sections : []);
      setStyle({ ...DEFAULT_STYLE, ...(data.style || {}) });
      setRequireSignature(data.require_signature ?? true);
      setProposalNumber(data.proposal_number || "");
      setReference(data.reference || "");
      if (data.proposal_date) setProposalDate(String(data.proposal_date).slice(0, 10));
    })();
  }, [proposalId]);

  // Seed from a template passed via URL
  useEffect(() => {
    if (!templateIdParam || proposalId || templates.length === 0) return;
    const t = (templates as any[]).find((x) => x.id === templateIdParam);
    if (t) {
      setSections(Array.isArray(t.sections) ? t.sections : []);
      if (t.style) setStyle({ ...DEFAULT_STYLE, ...t.style });
    }
  }, [templateIdParam, templates, proposalId]);

  const total = useMemo(() => proposalTotal(sections), [sections]);

  const addSection = (section: ProposalSection) => setSections((prev) => [...prev, section]);

  const patchSection = (sid: string, patch: Partial<ProposalSection>) =>
    setSections((prev) => prev.map((s) => (s.id === sid ? { ...s, ...patch } : s)));

  const moveSection = (index: number, dir: -1 | 1) =>
    setSections((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const save = async (nextStatus?: string) => {
    if (!companyId) {
      toast({ title: "No company found for your profile", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload: Record<string, any> = {
      company_id: companyId,
      client_id: clientId,
      title,
      status: nextStatus || status,
      sections,
      style,
      require_signature: requireSignature,
      proposal_date: proposalDate,
      reference: reference || null,
      total,
      created_by: user?.id ?? null,
    };
    if (nextStatus === "sent") payload.sent_at = new Date().toISOString();

    try {
      if (id) {
        const { error } = await db.from("visual_proposals").update(payload).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await db
          .from("visual_proposals")
          .insert(payload)
          .select("id, proposal_number")
          .single();
        if (error) throw error;
        setId(data.id);
        if (data.proposal_number) setProposalNumber(data.proposal_number);
      }
      if (nextStatus) setStatus(nextStatus);
      qc.invalidateQueries({ queryKey: ["visual-proposals"] });
      toast({
        title: nextStatus === "sent" ? "Proposal sent" : "Proposal saved",
        description: nextStatus === "sent" ? "Marked as sent." : "Saved as draft.",
      });
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const saveAsTemplate = async () => {
    if (!companyId || !templateName.trim()) return;
    const { error } = await db.from("visual_proposal_templates").insert({
      company_id: companyId,
      created_by: user?.id ?? null,
      name: templateName.trim(),
      description: templateDesc.trim() || null,
      sections,
      style,
    });
    if (error) {
      toast({ title: "Could not save template", description: error.message, variant: "destructive" });
      return;
    }
    setTemplateDialog(false);
    setTemplateName("");
    setTemplateDesc("");
    qc.invalidateQueries({ queryKey: ["visual-proposal-templates"] });
    toast({ title: "Template saved", description: "Reuse it when creating a new proposal." });
  };

  const previewProps = {
    title,
    clientName,
    proposalNumber,
    proposalDate,
    companyName: settings?.company_name || settings?.name || undefined,
    companyLogo,
    sections,
    style,
    requireSignature,
  };

  return (
    <div className={`min-h-full bg-background ${STICKY_ACTION_BAR_SPACER}`}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" className="-ml-2 mb-1" onClick={() => navigate("/admin/quotes")}>
            <ArrowLeft className="mr-1 h-4 w-4" /> Estimates and Proposals
          </Button>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {id ? "Edit Proposal" : "New Proposal"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Build a flexible, visual document with rich text, pricing, attachments and an
            acceptance signature.
          </p>
        </div>
        <Button variant="outline" onClick={() => setTemplateDialog(true)}>
          <BookmarkPlus className="mr-2 h-4 w-4" /> Save as Template
        </Button>
      </div>

      <div className="space-y-5 p-4 sm:p-6">
        {/* Document meta */}
        <Card className="shadow-sm">
          <CardContent className="grid gap-4 p-4 sm:grid-cols-3 lg:grid-cols-5">
            <div className="space-y-1 lg:col-span-2">
              <Label>Proposal title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Client</Label>
              <CustomerSearchSelector
                value={clientId || ""}
                selectedName={clientName}
                onSelect={(c: any) => {
                  setClientId(c.id);
                  setClientName(c.name);
                }}
              />
            </div>
            <div className="space-y-1">
              <Label>Date</Label>
              <Input
                type="date"
                value={proposalDate}
                onChange={(e) => setProposalDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROPOSAL_STATUSES.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Reference (optional)</Label>
              <Input
                placeholder="PO number or client reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="build">
          <TabsList>
            <TabsTrigger value="build">Build</TabsTrigger>
            <TabsTrigger value="style">
              <Paintbrush className="mr-1 h-3.5 w-3.5" /> Style
            </TabsTrigger>
            <TabsTrigger value="preview">
              <Eye className="mr-1 h-3.5 w-3.5" /> Client preview
            </TabsTrigger>
          </TabsList>

          <TabsContent value="build" className="mt-4">
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="space-y-3">
                {sections.map((s, i) => (
                  <ProposalSectionEditor
                    key={s.id}
                    section={s}
                    index={i}
                    total={sections.length}
                    themeColor={style.themeColor}
                    onChange={(patch) => patchSection(s.id, patch)}
                    onMove={(dir) => moveSection(i, dir)}
                    onDelete={() => setSections((prev) => prev.filter((x) => x.id !== s.id))}
                  />
                ))}

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="w-full">
                      <Plus className="mr-2 h-4 w-4" /> Add section
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56 bg-popover">
                    {RICH_PRESET_OPTIONS.map((o) => (
                      <DropdownMenuItem
                        key={o.preset}
                        onClick={() => addSection(richTextSection(o.preset as RichTextPreset))}
                      >
                        {o.label}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuItem onClick={() => addSection(pricingSection())}>
                      Pricing / line items
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => addSection(attachmentsSection())}>
                      Attachments
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Live preview */}
              <div className="hidden lg:block">
                <div className="sticky top-4 max-h-[calc(100vh-8rem)] overflow-y-auto rounded-lg border bg-muted/30 p-3">
                  <VisualProposalPreview {...previewProps} />
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="style" className="mt-4">
            <Card className="shadow-sm">
              <CardContent className="space-y-5 p-4">
                <div className="space-y-2">
                  <Label>Template</Label>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {TEMPLATE_STYLES.map((t) => (
                      <button
                        key={t.value}
                        type="button"
                        className={`rounded-lg border p-3 text-left text-sm transition ${
                          style.template === t.value
                            ? "border-2 shadow-sm"
                            : "hover:bg-muted/50"
                        }`}
                        style={
                          style.template === t.value ? { borderColor: style.themeColor } : undefined
                        }
                        onClick={() => setStyle({ ...style, template: t.value })}
                      >
                        <p className="font-semibold">{t.label}</p>
                        <p className="text-xs text-muted-foreground">{t.hint}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Theme colour</Label>
                  <div className="flex flex-wrap gap-2">
                    {THEME_COLORS.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        aria-label={c.name}
                        title={c.name}
                        className={`h-8 w-8 rounded-full border-2 ${
                          style.themeColor === c.value ? "ring-2 ring-offset-2" : "border-transparent"
                        }`}
                        style={{ backgroundColor: c.value }}
                        onClick={() => setStyle({ ...style, themeColor: c.value })}
                      />
                    ))}
                    <Input
                      type="color"
                      className="h-8 w-12 p-1"
                      value={style.themeColor}
                      onChange={(e) => setStyle({ ...style, themeColor: e.target.value })}
                      aria-label="Custom theme colour"
                    />
                  </div>
                </div>

                <div className="space-y-1 sm:max-w-xs">
                  <Label>Font</Label>
                  <Select
                    value={style.font}
                    onValueChange={(v) => setStyle({ ...style, font: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FONT_OPTIONS.map((f) => (
                        <SelectItem key={f.value} value={f.value}>
                          {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {style.template === "modern" && (
                  <div className="space-y-1">
                    <Label>Hero image</Label>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        className="min-w-[200px] flex-1"
                        placeholder="Image URL"
                        value={style.heroImage?.startsWith("data:") ? "" : style.heroImage || ""}
                        onChange={(e) => setStyle({ ...style, heroImage: e.target.value })}
                      />
                      <label className="inline-flex cursor-pointer items-center gap-1 rounded-md border px-3 py-2 text-sm hover:bg-muted">
                        Upload
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            const reader = new FileReader();
                            reader.onload = () =>
                              setStyle({ ...style, heroImage: String(reader.result) });
                            reader.readAsDataURL(f);
                          }}
                        />
                      </label>
                    </div>
                  </div>
                )}

                <label className="flex items-center gap-3 text-sm">
                  <Switch checked={requireSignature} onCheckedChange={setRequireSignature} />
                  Require client signature to accept
                </label>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="preview" className="mt-4">
            <div className="rounded-lg border bg-muted/30 p-3">
              <VisualProposalPreview {...previewProps} />
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <StickyActionBar align="between">
        <span className="text-sm text-muted-foreground">
          {sections.length} section{sections.length !== 1 ? "s" : ""}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" disabled={saving} onClick={() => save()}>
            <Save className="mr-2 h-4 w-4" /> Save as Draft
          </Button>
          <Button variant="brand" disabled={saving} onClick={() => save("sent")}>
            <Send className="mr-2 h-4 w-4" /> Send
          </Button>
        </div>
      </StickyActionBar>

      {/* Start from template */}
      <Dialog open={pickTemplate} onOpenChange={setPickTemplate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start your proposal</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <button
              type="button"
              className="w-full rounded-md border p-3 text-left text-sm hover:bg-muted"
              onClick={() => setPickTemplate(false)}
            >
              <p className="font-semibold">Blank proposal</p>
              <p className="text-xs text-muted-foreground">Start from an empty document.</p>
            </button>
            <button
              type="button"
              className="w-full rounded-md border p-3 text-left text-sm hover:bg-muted"
              onClick={() => {
                setSections([
                  richTextSection("overview"),
                  richTextSection("scope"),
                  pricingSection(),
                ]);
                setPickTemplate(false);
              }}
            >
              <p className="font-semibold">Standard proposal</p>
              <p className="text-xs text-muted-foreground">
                Overview, scope of work and pricing.
              </p>
            </button>
            {(templates as any[]).map((t) => (
              <button
                key={t.id}
                type="button"
                className="flex w-full items-start gap-2 rounded-md border p-3 text-left text-sm hover:bg-muted"
                onClick={() => {
                  setSections(Array.isArray(t.sections) ? t.sections : []);
                  if (t.style) setStyle({ ...DEFAULT_STYLE, ...t.style });
                  setPickTemplate(false);
                }}
              >
                <LayoutTemplate className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block font-semibold">{t.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t.description || `${(t.sections || []).length} sections`}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Save as template */}
      <Dialog open={templateDialog} onOpenChange={setTemplateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save as Template</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Template name</Label>
              <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Description (optional)</Label>
              <Input value={templateDesc} onChange={(e) => setTemplateDesc(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTemplateDialog(false)}>
              Cancel
            </Button>
            <Button variant="brand" disabled={!templateName.trim()} onClick={saveAsTemplate}>
              Save template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminProposalBuilderPage;
