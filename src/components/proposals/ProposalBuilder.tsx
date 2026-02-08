import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Eye,
  Save,
  Loader2,
  ArrowLeft,
  FileText,
} from "lucide-react";
import ProposalPreview from "./ProposalPreview";

const SECTION_TYPES = [
  { value: "cover", label: "Cover Page", color: "bg-blue-100 text-blue-800" },
  { value: "summary", label: "Executive Summary", color: "bg-purple-100 text-purple-800" },
  { value: "assessment", label: "Site Assessment", color: "bg-orange-100 text-orange-800" },
  { value: "scope", label: "Scope of Work", color: "bg-green-100 text-green-800" },
  { value: "solution", label: "Solution", color: "bg-cyan-100 text-cyan-800" },
  { value: "pricing", label: "Pricing", color: "bg-yellow-100 text-yellow-800" },
  { value: "timeline", label: "Timeline", color: "bg-indigo-100 text-indigo-800" },
  { value: "terms", label: "Terms & Conditions", color: "bg-red-100 text-red-800" },
  { value: "warranty", label: "Warranty", color: "bg-emerald-100 text-emerald-800" },
  { value: "about", label: "About Us", color: "bg-gray-100 text-gray-800" },
];

interface Section {
  id?: string;
  section_type: string;
  title: string;
  content: string;
  sort_order: number;
  photos: string[];
}

interface ProposalBuilderProps {
  quoteId: string;
  onBack: () => void;
}

const ProposalBuilder = ({ quoteId, onBack }: ProposalBuilderProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [sections, setSections] = useState<Section[]>([]);
  const [saving, setSaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Fetch existing sections
  const { data: existingSections, isLoading } = useQuery({
    queryKey: ["proposal-sections", quoteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("proposal_sections")
        .select("*")
        .eq("quote_id", quoteId)
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  // Fetch templates
  const { data: templates = [] } = useQuery({
    queryKey: ["proposal-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("proposal_templates")
        .select("*")
        .order("section_type");
      if (error) throw error;
      return data;
    },
  });

  // Fetch quote info
  const { data: quote } = useQuery({
    queryKey: ["quote-detail", quoteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotes")
        .select("*, customers(name, phone, email, address), quote_line_items(*)")
        .eq("id", quoteId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (existingSections?.length) {
      setSections(
        existingSections.map((s: any) => ({
          id: s.id,
          section_type: s.section_type,
          title: s.title,
          content: s.content || "",
          sort_order: s.sort_order,
          photos: Array.isArray(s.photos) ? s.photos : [],
        }))
      );
    }
  }, [existingSections]);

  const addFromTemplate = (templateId: string) => {
    const tmpl = templates.find((t: any) => t.id === templateId);
    if (!tmpl) return;
    setSections((prev) => [
      ...prev,
      {
        section_type: tmpl.section_type,
        title: tmpl.default_title,
        content: tmpl.default_content,
        sort_order: prev.length,
        photos: [],
      },
    ]);
  };

  const addBlankSection = (type: string) => {
    const typeInfo = SECTION_TYPES.find((t) => t.value === type);
    setSections((prev) => [
      ...prev,
      {
        section_type: type,
        title: typeInfo?.label || "New Section",
        content: "",
        sort_order: prev.length,
        photos: [],
      },
    ]);
  };

  const moveSection = (index: number, direction: -1 | 1) => {
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= sections.length) return;
    const updated = [...sections];
    [updated[index], updated[newIndex]] = [updated[newIndex], updated[index]];
    updated.forEach((s, i) => (s.sort_order = i));
    setSections(updated);
  };

  const updateSection = (index: number, field: keyof Section, value: any) => {
    setSections((prev) => prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  };

  const removeSection = (index: number) => {
    setSections((prev) => prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, sort_order: i })));
  };

  const saveProposal = async () => {
    setSaving(true);
    try {
      // Delete existing sections and re-insert
      await supabase.from("proposal_sections").delete().eq("quote_id", quoteId);

      if (sections.length > 0) {
        const { error } = await supabase.from("proposal_sections").insert(
          sections.map((s) => ({
            quote_id: quoteId,
            section_type: s.section_type,
            title: s.title,
            content: s.content,
            sort_order: s.sort_order,
            photos: s.photos,
          }))
        );
        if (error) throw error;
      }

      queryClient.invalidateQueries({ queryKey: ["proposal-sections", quoteId] });
      toast({ title: "Proposal saved!" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const getSectionColor = (type: string) =>
    SECTION_TYPES.find((t) => t.value === type)?.color || "bg-muted text-muted-foreground";

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">Loading proposal...</div>;

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-xl font-bold">Proposal Builder</h2>
            <p className="text-sm text-muted-foreground">
              {quote?.quote_number} • {(quote as any)?.customers?.name || "Customer"}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setPreviewOpen(true)}>
            <Eye className="h-4 w-4 mr-2" /> Preview
          </Button>
          <Button onClick={saveProposal} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            Save
          </Button>
        </div>
      </div>

      {/* Add section controls */}
      <Card>
        <CardContent className="py-3 px-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">Add:</span>
            <Select onValueChange={addFromTemplate}>
              <SelectTrigger className="w-52 h-8 text-xs">
                <SelectValue placeholder="From template..." />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t: any) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select onValueChange={addBlankSection}>
              <SelectTrigger className="w-44 h-8 text-xs">
                <SelectValue placeholder="Blank section..." />
              </SelectTrigger>
              <SelectContent>
                {SECTION_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Sections */}
      {sections.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="h-10 w-10 mx-auto mb-2 opacity-50" />
          <p>No sections yet. Add from a template or create a blank section above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sections.map((section, index) => (
            <Card key={index} className="border-l-4" style={{ borderLeftColor: section.section_type === 'cover' ? '#0077B6' : undefined }}>
              <CardHeader className="py-2 px-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge className={getSectionColor(section.section_type)} variant="outline">
                      {SECTION_TYPES.find((t) => t.value === section.section_type)?.label}
                    </Badge>
                    <span className="text-xs text-muted-foreground">#{index + 1}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveSection(index, -1)} disabled={index === 0}>
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => moveSection(index, 1)} disabled={index === sections.length - 1}>
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeSection(index)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                <Input
                  value={section.title}
                  onChange={(e) => updateSection(index, "title", e.target.value)}
                  className="font-semibold"
                  placeholder="Section title"
                />
                <Textarea
                  value={section.content}
                  onChange={(e) => updateSection(index, "content", e.target.value)}
                  rows={8}
                  placeholder="Section content (supports Markdown)"
                  className="text-sm font-mono"
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Preview Modal */}
      <ProposalPreview
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        sections={sections}
        quote={quote}
      />
    </div>
  );
};

export default ProposalBuilder;
