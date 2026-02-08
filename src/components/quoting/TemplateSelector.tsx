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

interface TemplateSelectorProps {
  onSelect: (items: { service_id: string | null; description: string; quantity: number; unit_price: number }[]) => void;
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
    const { data: items, error } = await supabase
      .from("quote_template_items")
      .select("*")
      .eq("template_id", templateId);
    if (error || !items) return;
    onSelect(
      items.map((item: any) => ({
        service_id: item.service_id,
        description: item.description,
        quantity: item.quantity,
        unit_price: Number(item.unit_price),
      }))
    );
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
              {t.description && (
                <span className="ml-2 text-xs text-muted-foreground">{t.description}</span>
              )}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

export default TemplateSelector;
