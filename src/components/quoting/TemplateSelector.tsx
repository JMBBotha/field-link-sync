import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileText } from "lucide-react";
import type { VisualSection } from "./VisualSectionEditor";

interface TemplateSelectorProps {
  onSelect: (
    items: { service_id: string | null; description: string; quantity: number; unit_price: number }[],
    sections?: VisualSection[],
    termsText?: string
  ) => void;
}

const TemplateSelector = ({ onSelect }: TemplateSelectorProps) => {
  const { data: templates = [] } = useQuery({
    queryKey: ["quote-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quote_templates")
        .select("*")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const handleSelect = async (templateId: string) => {
    const template = templates.find((t: any) => t.id === templateId);

    // Try loading line items from the new jsonb column first
    let items: any[] = [];
    const templateLineItems = template?.line_items;
    if (Array.isArray(templateLineItems) && templateLineItems.length > 0) {
      items = templateLineItems.map((item: any) => ({
        service_id: item.service_id || null,
        description: item.description,
        quantity: item.quantity || 1,
        unit_price: Number(item.unit_price) || 0,
      }));
    } else {
      // Fall back to quote_template_items table
      const { data: legacyItems, error } = await supabase
        .from("quote_template_items")
        .select("*")
        .eq("template_id", templateId);
      if (!error && legacyItems) {
        items = legacyItems.map((item: any) => ({
          service_id: item.service_id,
          description: item.description,
          quantity: item.quantity,
          unit_price: Number(item.unit_price),
        }));
      }
    }

    // Load visual sections from template
    const sections = Array.isArray(template?.sections) ? (template.sections as unknown as VisualSection[]) : undefined;
    const termsText = template?.terms_text || undefined;

    onSelect(items, sections, termsText);
  };

  return (
    <Select onValueChange={handleSelect}>
      <SelectTrigger className="w-full">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <SelectValue placeholder="Load from template..." />
        </div>
      </SelectTrigger>
      <SelectContent>
        {templates.map((t: any) => (
          <SelectItem key={t.id} value={t.id}>
            <div>
              <span className="font-medium">{t.name}</span>
              {t.category && (
                <span className="ml-2 text-xs text-muted-foreground">{t.category}</span>
              )}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

export default TemplateSelector;
