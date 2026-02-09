import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, BookmarkPlus } from "lucide-react";
import type { VisualSection } from "./VisualSectionEditor";

interface LineItem {
  description: string;
  quantity: number;
  unit_price: number;
  service_id?: string;
}

interface TemplateSaveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lineItems: LineItem[];
  sections: VisualSection[];
  termsText: string;
}

const TemplateSaveDialog = ({
  open,
  onOpenChange,
  lineItems,
  sections,
  termsText,
}: TemplateSaveDialogProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");

  const handleSave = async () => {
    if (!name.trim()) {
      toast({ title: "Enter a template name", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { data: session } = await supabase.auth.getSession();

      const templatePayload = {
        name: name.trim(),
        category: category.trim() || null,
        description: description.trim() || null,
        line_items: lineItems.map((li) => ({
          description: li.description,
          quantity: li.quantity,
          unit_price: li.unit_price,
        })),
        sections: sections,
        terms_text: termsText || null,
        is_active: true,
        created_by: session?.session?.user?.id || null,
      };

      const { data: template, error } = await supabase
        .from("quote_templates")
        .insert({
          name: templatePayload.name,
          category: templatePayload.category,
          description: templatePayload.description,
          line_items: templatePayload.line_items as any,
          sections: templatePayload.sections as any,
          terms_text: templatePayload.terms_text,
          is_active: templatePayload.is_active,
        })
        .select("id")
        .single();
      if (error) throw error;

      // Also insert into quote_template_items for backward compatibility
      if (lineItems.length > 0 && template) {
        const items = lineItems
          .filter((li) => li.description.trim())
          .map((li) => ({
            template_id: template.id,
            description: li.description,
            quantity: li.quantity,
            unit_price: li.unit_price,
            service_id: li.service_id || null,
          }));
        if (items.length > 0) {
          await supabase.from("quote_template_items").insert(items);
        }
      }

      queryClient.invalidateQueries({ queryKey: ["quote-templates"] });
      toast({ title: "Template saved! 📋" });
      onOpenChange(false);
      setName("");
      setCategory("");
      setDescription("");
    } catch (err: any) {
      toast({
        title: "Error saving template",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookmarkPlus className="h-5 w-5" /> Save as Template
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Template Name *</Label>
            <Input
              placeholder="e.g. Samsung AR40 18K BTU Install"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <Label>Category</Label>
            <Input
              placeholder="e.g. Samsung AR40, Daikin, Maintenance"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea
              placeholder="Brief description of this template..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          <div className="text-xs text-muted-foreground space-y-1">
            <p>
              This will save: <strong>{lineItems.length}</strong> line item(s),{" "}
              <strong>{sections.length}</strong> visual section(s)
              {termsText ? ", custom terms" : ""}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <BookmarkPlus className="h-4 w-4 mr-2" />
            )}
            Save Template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default TemplateSaveDialog;
