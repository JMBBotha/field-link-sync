import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { ArrowLeft, Plus, Save, Send, Eye, BookmarkPlus, LayoutTemplate } from "lucide-react";
import StickyActionBar, { STICKY_ACTION_BAR_SPACER } from "@/components/shared/StickyActionBar";
import CustomerSearchSelector from "@/components/customers/CustomerSearchSelector";
import ProposalSectionEditor from "@/components/proposals/visual/ProposalSectionEditor";
import VisualProposalPreview from "@/components/proposals/visual/VisualProposalPreview";
import {
  ProposalSection,
  ProposalSectionType,
  PROPOSAL_STATUSES,
  blankSection,
  proposalTotal,
} from "@/types/visualProposal";

const SECTION_OPTIONS: { type: ProposalSectionType; label: string }[] = [
  { type: "cover", label: "Cover / Title block" },
  { type: "text", label: "Text block" },
  { type: "image", label: "Image block" },
  { type: "pricing", label: "Pricing / line items" },
  { type: "signature", label: "Signature block" },
];

const db = supabase as any;

const AdminProposalBuilderPage = () => {
  const [params] = useSearchParams();
  const proposalId = params.get("proposalId");
  const templateIdParam = params.get("templateId");
  const navigate = useNavigate();
  const { user } = useAuth();
  const { companyId } = useUserCompanyId();
  const { toast } = useToast();
  const qc = useQueryClient();

  const [id, setId] = useState<string | null>(proposalId);
  const [title, setTitle] = useState("Untitled Proposal");
  const [status, setStatus] = useState<string>("draft");
  const [clientId, setClientId] = useState<string | null>(null);
  const [clientName, setClientName] = useState("");
  const [sections, setSections] = useState<ProposalSection[]>([]);
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
    })();
  }, [proposalId]);

  // Seed from a template passed via URL
  useEffect(() => {
    if (!templateIdParam || proposalId || templates.length === 0) return;
    const t = (templates as any[]).find((x) => x.id === templateIdParam);
    if (t) setSections(Array.isArray(t.sections) ? t.sections : []);
  }, [templateIdParam, templates, proposalId]);

  const total = useMemo(() => proposalTotal(sections), [sections]);

  const addSection = (type: ProposalSectionType) =>
    setSections((prev) => [...prev, blankSection(type)]);

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
          .select("id")
          .single();
        if (error) throw error;
        setId(data.id);
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
            Build a flexible, visual document with sections, images and an acceptance signature.
          </p>
        </div>
        <Button variant="outline" onClick={() => setTemplateDialog(true)}>
          <BookmarkPlus className="mr-2 h-4 w-4" /> Save as Template
        </Button>
      </div>

      <div className="space-y-5 p-4 sm:p-6">
        {/* Document meta */}
        <Card className="shadow-sm">
          <CardContent className="grid gap-4 p-4 sm:grid-cols-3">
            <div className="space-y-1">
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
          </CardContent>
        </Card>

        <Tabs defaultValue="build">
          <TabsList>
            <TabsTrigger value="build">Build</TabsTrigger>
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
                    {SECTION_OPTIONS.map((o) => (
                      <DropdownMenuItem key={o.type} onClick={() => addSection(o.type)}>
                        {o.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {/* Live preview */}
              <div className="hidden lg:block">
                <div className="sticky top-4 max-h-[calc(100vh-8rem)] overflow-y-auto rounded-lg border bg-muted/30 p-3">
                  <VisualProposalPreview
                    title={title}
                    clientName={clientName}
                    sections={sections}
                  />
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="preview" className="mt-4">
            <div className="rounded-lg border bg-muted/30 p-3">
              <VisualProposalPreview title={title} clientName={clientName} sections={sections} />
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
            {(templates as any[]).map((t) => (
              <button
                key={t.id}
                type="button"
                className="flex w-full items-start gap-2 rounded-md border p-3 text-left text-sm hover:bg-muted"
                onClick={() => {
                  setSections(Array.isArray(t.sections) ? t.sections : []);
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
