import { HelpCircle } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface HelpTipProps {
  /** Short heading shown at the top of the popover. */
  title?: string;
  /** Body copy (string or React node). Keep it to 1-2 sentences. */
  children: React.ReactNode;
  /** Extra classes for the trigger icon. */
  className?: string;
  /** Accessible label — defaults to "Help". */
  label?: string;
  side?: "top" | "right" | "bottom" | "left";
}

/**
 * Inline help popover. Renders a small (?) icon; click/tap opens a short
 * explanation. Use next to buttons, form fields, or table headers where a
 * one-line hint would help a new user without cluttering the UI.
 */
const HelpTip = ({ title, children, className, label = "Help", side = "top" }: HelpTipProps) => (
  <Popover>
    <PopoverTrigger asChild>
      <button
        type="button"
        aria-label={label}
        className={cn(
          "inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors",
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
    </PopoverTrigger>
    <PopoverContent side={side} className="w-64 text-xs leading-relaxed">
      {title && <p className="font-semibold text-sm mb-1">{title}</p>}
      <div className="text-muted-foreground">{children}</div>
    </PopoverContent>
  </Popover>
);

export default HelpTip;
