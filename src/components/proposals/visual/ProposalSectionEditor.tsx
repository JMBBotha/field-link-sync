import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronUp, ChevronDown, Trash2, GripVertical } from "lucide-react";
import { ProposalSection } from "@/types/visualProposal";
import RichTextBlock from "./RichTextBlock";
import PricingBlock from "./PricingBlock";
import AttachmentsBlock from "./AttachmentsBlock";
import { Input } from "@/components/ui/input";

interface Props {
  section: ProposalSection;
  index: number;
  total: number;
  themeColor?: string;
  onChange: (patch: Partial<ProposalSection>) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}

const ProposalSectionEditor = ({
  section,
  index,
  total,
  themeColor = "#1B3A5C",
  onChange,
  onMove,
  onDelete,
}: Props) => (
  <Card className="shadow-sm">
    <CardContent className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <GripVertical className="h-4 w-4 cursor-grab text-muted-foreground" />
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            aria-label="Move section up"
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
            aria-label="Move section down"
          >
            <ChevronDown className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive"
            onClick={onDelete}
            aria-label="Delete section"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {section.type === "richtext" && (
        <div className="space-y-2">
          <Input
            className="border-0 px-0 text-lg font-semibold shadow-none focus-visible:ring-0"
            placeholder="Section heading"
            value={section.title || ""}
            onChange={(e) => onChange({ title: e.target.value })}
            style={{ color: themeColor }}
          />
          <RichTextBlock
            html={section.html || ""}
            placeholder={section.placeholder}
            themeColor={themeColor}
            onChange={(html) => onChange({ html })}
          />
        </div>
      )}

      {section.type === "pricing" && (
        <PricingBlock section={section} onChange={onChange} themeColor={themeColor} />
      )}

      {section.type === "attachments" && (
        <AttachmentsBlock section={section} onChange={onChange} themeColor={themeColor} />
      )}
    </CardContent>
  </Card>
);

export default ProposalSectionEditor;
