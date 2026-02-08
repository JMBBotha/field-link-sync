import { Button } from "@/components/ui/button";
import { X, Trash2, Send, CheckSquare } from "lucide-react";

interface BulkActionBarProps {
  selectedCount: number;
  onClear: () => void;
  actions: {
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    variant?: "default" | "destructive";
  }[];
}

const BulkActionBar = ({ selectedCount, onClear, actions }: BulkActionBarProps) => {
  if (selectedCount === 0) return null;

  return (
    <div className="sticky top-0 z-20 bg-primary text-primary-foreground px-4 py-2.5 flex items-center gap-3 rounded-lg shadow-lg animate-in slide-in-from-top-2">
      <CheckSquare className="h-4 w-4" />
      <span className="text-sm font-medium">{selectedCount} selected</span>
      <div className="flex-1" />
      {actions.map((action, i) => (
        <Button
          key={i}
          size="sm"
          variant={action.variant === "destructive" ? "destructive" : "secondary"}
          onClick={action.onClick}
          className="gap-1.5 text-xs"
        >
          {action.icon}
          {action.label}
        </Button>
      ))}
      <Button size="sm" variant="ghost" onClick={onClear} className="text-primary-foreground hover:bg-primary-foreground/10">
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
};

export default BulkActionBar;
