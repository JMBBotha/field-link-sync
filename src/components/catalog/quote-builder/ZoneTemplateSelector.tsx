import { useState } from "react";
import { LayoutTemplate, Home, Building2, Store, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

interface ZoneTemplate {
  label: string;
  icon: React.ReactNode;
  zones: string[];
}

const ZONE_TEMPLATES: ZoneTemplate[] = [
  {
    label: "Residential Home",
    icon: <Home className="h-3.5 w-3.5" />,
    zones: ["Living Area", "Bedroom 1", "Bedroom 2", "Bedroom 3", "Kitchen"],
  },
  {
    label: "Office",
    icon: <Building2 className="h-3.5 w-3.5" />,
    zones: ["Reception", "Open Plan", "Server Room", "Boardroom"],
  },
  {
    label: "Retail",
    icon: <Store className="h-3.5 w-3.5" />,
    zones: ["Shop Floor", "Storeroom", "Office"],
  },
];

interface ZoneTemplateSelectorProps {
  onApplyTemplate: (zones: string[]) => void;
}

const ZoneTemplateSelector = ({ onApplyTemplate }: ZoneTemplateSelectorProps) => {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1">
          <LayoutTemplate className="h-3 w-3" />
          Templates
          <ChevronDown className="h-2.5 w-2.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="text-[10px] text-muted-foreground">
          Zone Templates
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {ZONE_TEMPLATES.map((t) => (
          <DropdownMenuItem
            key={t.label}
            className="text-xs gap-2 cursor-pointer"
            onClick={() => onApplyTemplate(t.zones)}
          >
            {t.icon}
            <div className="flex-1">
              <p className="font-medium">{t.label}</p>
              <p className="text-[10px] text-muted-foreground">{t.zones.length} zones</p>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default ZoneTemplateSelector;
