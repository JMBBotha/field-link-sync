import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Star, FileText, ArrowLeft, Eye, Loader2, Copy, Palette } from "lucide-react";
import InvoiceTemplatePreview from "@/components/invoicing/InvoiceTemplatePreview";

export interface InvoiceTemplateConfig {
  logoPosition: "left" | "center" | "right";
  primaryColor: string;
  accentColor: string;
  fontFamily: string;
  invoiceTitle: string;
  numberFormat: string;
  showColumns: {
    description: boolean;
    quantity: boolean;
    unitPrice: boolean;
    discount: boolean;
    tax: boolean;
    total: boolean;
  };
  sections: {
    companyDetails: boolean;
    clientInfo: boolean;
    lineItems: boolean;
    subtotals: boolean;
    paymentTerms: boolean;
    notes: boolean;
    bankDetails: boolean;
  };
  paymentTermsText: string;
  footerText: string;
  bankDetailsText: string;
}

const defaultConfig: InvoiceTemplateConfig = {
  logoPosition: "left",
  primaryColor: "#0077B6",
  accentColor: "#023E8A",
  fontFamily: "Inter",
  invoiceTitle: "TAX INVOICE",
  numberFormat: "INV-{number}",
  showColumns: {
    description: true,
    quantity: true,
    unitPrice: true,
    discount: false,
    tax: false,
    total: true,
  },
  sections: {
    companyDetails: true,
    clientInfo: true,
    lineItems: true,
    subtotals: true,
    paymentTerms: true,
    notes: true,
    bankDetails: true,
  },
  paymentTermsText: "Payment due within 30 days of invoice date.",
  footerText: "Thank you for your business!",
  bankDetailsText: "",
};

const fontOptions = [
  { value: "Inter", label: "Inter" },
  { value: "Georgia", label: "Georgia (Serif)" },
  { value: "Courier New", label: "Courier New (Mono)" },
  { value: "Arial", label: "Arial" },
  { value: "Helvetica", label: "Helvetica" },
];

const AdminInvoiceTemplatesPage = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingTemplate, setEditingTemplate] = useState<any | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [name, setName] = useState("");
  const [config, setConfig] = useState<InvoiceTemplateConfig>({ ...defaultConfig });
  const [showPreview, setShowPreview] = useState(false);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["invoice-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoice_templates" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (params: { id?: string; name: string; config: InvoiceTemplateConfig; isDefault: boolean }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      if (params.isDefault) {
        await supabase
          .from("invoice_templates" as any)
          .update({ is_default: false } as any)
          .neq("id", params.id || "");
      }

      if (params.id) {
        const { error } = await supabase
          .from("invoice_templates" as any)
          .update({ name: params.name, config: params.config as any, is_default: params.isDefault } as any)
          .eq("id", params.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("invoice_templates" as any)
          .insert({ name: params.name, config: params.config as any, is_default: params.isDefault, created_by: session.user.id } as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoice-templates"] });
      toast({ title: "Template saved ✅" });
      closeEditor();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("invoice_templates" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoice-templates"] });
      toast({ title: "Template deleted" });
    },
  });

  const openEditor = (template?: any) => {
    if (template) {
      setEditingTemplate(template);
      setName(template.name);
      setConfig({ ...defaultConfig, ...(template.config as any) });
    } else {
      setEditingTemplate(null);
      setName("");
      setConfig({ ...defaultConfig });
    }
    setShowEditor(true);
  };

  const closeEditor = () => {
    setShowEditor(false);
    setEditingTemplate(null);
  };

  const updateConfig = <K extends keyof InvoiceTemplateConfig>(key: K, value: InvoiceTemplateConfig[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const updateSections = (key: keyof InvoiceTemplateConfig["sections"], value: boolean) => {
    setConfig(prev => ({ ...prev, sections: { ...prev.sections, [key]: value } }));
  };

  const updateColumns = (key: keyof InvoiceTemplateConfig["showColumns"], value: boolean) => {
    setConfig(prev => ({ ...prev, showColumns: { ...prev.showColumns, [key]: value } }));
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  if (showEditor) {
    return (
      <div className="p-4 space-y-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={closeEditor}><ArrowLeft className="h-5 w-5" /></Button>
          <h1 className="text-lg font-bold">{editingTemplate ? "Edit Template" : "New Template"}</h1>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => setShowPreview(!showPreview)}>
            <Eye className="h-4 w-4 mr-1" /> {showPreview ? "Hide Preview" : "Preview"}
          </Button>
          <Button
            size="sm"
            onClick={() => saveMutation.mutate({ id: editingTemplate?.id, name, config, isDefault: editingTemplate?.is_default || false })}
            disabled={!name.trim() || saveMutation.isPending}
          >
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            Save Template
          </Button>
        </div>

        <div className={`grid gap-4 ${showPreview ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1 max-w-2xl"}`}>
          {/* Editor Panel */}
          <div className="space-y-4">
            {/* Name */}
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4 space-y-3">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Template Name</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Standard Invoice" />
              </CardContent>
            </Card>

            {/* Appearance */}
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4 space-y-3">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  <Palette className="h-3.5 w-3.5" /> Appearance
                </Label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Primary Color</Label>
                    <div className="flex gap-2 items-center">
                      <input type="color" value={config.primaryColor} onChange={e => updateConfig("primaryColor", e.target.value)} className="h-9 w-12 rounded border cursor-pointer" />
                      <Input value={config.primaryColor} onChange={e => updateConfig("primaryColor", e.target.value)} className="h-9 text-xs flex-1" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Accent Color</Label>
                    <div className="flex gap-2 items-center">
                      <input type="color" value={config.accentColor} onChange={e => updateConfig("accentColor", e.target.value)} className="h-9 w-12 rounded border cursor-pointer" />
                      <Input value={config.accentColor} onChange={e => updateConfig("accentColor", e.target.value)} className="h-9 text-xs flex-1" />
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Font</Label>
                    <Select value={config.fontFamily} onValueChange={v => updateConfig("fontFamily", v)}>
                      <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {fontOptions.map(f => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Logo Position</Label>
                    <Select value={config.logoPosition} onValueChange={(v: any) => updateConfig("logoPosition", v)}>
                      <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="left">Left</SelectItem>
                        <SelectItem value="center">Center</SelectItem>
                        <SelectItem value="right">Right</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">Invoice Title</Label>
                  <Input value={config.invoiceTitle} onChange={e => updateConfig("invoiceTitle", e.target.value)} className="h-9 text-sm" />
                </div>
              </CardContent>
            </Card>

            {/* Layout Sections */}
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4 space-y-3">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Layout Blocks</Label>
                {(Object.keys(config.sections) as (keyof typeof config.sections)[]).map(key => (
                  <div key={key} className="flex items-center justify-between">
                    <Label className="text-sm capitalize">{key.replace(/([A-Z])/g, " $1").trim()}</Label>
                    <Switch checked={config.sections[key]} onCheckedChange={v => updateSections(key, v)} />
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Column Visibility */}
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4 space-y-3">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Line Item Columns</Label>
                {(Object.keys(config.showColumns) as (keyof typeof config.showColumns)[]).map(key => (
                  <div key={key} className="flex items-center justify-between">
                    <Label className="text-sm capitalize">{key.replace(/([A-Z])/g, " $1").trim()}</Label>
                    <Switch checked={config.showColumns[key]} onCheckedChange={v => updateColumns(key, v)} />
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Text Content */}
            <Card className="border-0 shadow-sm">
              <CardContent className="p-4 space-y-3">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Content</Label>
                {config.sections.paymentTerms && (
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Payment Terms</Label>
                    <Textarea value={config.paymentTermsText} onChange={e => updateConfig("paymentTermsText", e.target.value)} rows={2} className="text-sm" />
                  </div>
                )}
                {config.sections.notes && (
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Footer Text</Label>
                    <Input value={config.footerText} onChange={e => updateConfig("footerText", e.target.value)} className="h-9 text-sm" />
                  </div>
                )}
                {config.sections.bankDetails && (
                  <div>
                    <Label className="text-[10px] text-muted-foreground">Bank Details (EFT)</Label>
                    <Textarea value={config.bankDetailsText} onChange={e => updateConfig("bankDetailsText", e.target.value)} rows={3} className="text-sm" placeholder="Bank: FNB&#10;Account: 123456789&#10;Branch: 250655" />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Preview Panel */}
          {showPreview && (
            <div className="sticky top-4">
              <Card className="border-0 shadow-sm overflow-hidden">
                <CardContent className="p-0">
                  <InvoiceTemplatePreview config={config} />
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Invoice Templates</h1>
        <Button size="sm" onClick={() => openEditor()}>
          <Plus className="h-4 w-4 mr-1" /> New Template
        </Button>
      </div>

      {templates.length === 0 ? (
        <Card className="border-0 shadow-sm">
          <CardContent className="p-8 text-center">
            <FileText className="h-12 w-12 mx-auto mb-3 text-muted-foreground opacity-30" />
            <p className="text-sm text-muted-foreground mb-3">No templates yet. Create your first invoice template.</p>
            <Button onClick={() => openEditor()}><Plus className="h-4 w-4 mr-1" /> Create Template</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {templates.map((t: any) => (
            <Card key={t.id} className="border-0 shadow-sm hover:bg-accent/30 transition-colors">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: (t.config as any)?.primaryColor || "#0077B6" }}>
                      <FileText className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-sm">{t.name}</p>
                        {t.is_default && <Badge variant="secondary" className="text-[10px]"><Star className="h-3 w-3 mr-0.5" /> Default</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {(t.config as any)?.invoiceTitle || "TAX INVOICE"} • {(t.config as any)?.fontFamily || "Inter"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                      saveMutation.mutate({ id: t.id, name: t.name, config: t.config as any, isDefault: true });
                    }}>
                      <Star className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditor(t)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
                      openEditor({ ...t, id: undefined, name: t.name + " (Copy)" });
                    }}>
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteMutation.mutate(t.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdminInvoiceTemplatesPage;
