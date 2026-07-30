import { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Label for the primary green "create new" action. */
  actionLabel?: string;
  onAction?: () => void;
  actionIcon?: ReactNode;
  /** Items rendered inside the "More Actions" dropdown. */
  moreActions?: ReactNode;
  /** Extra controls rendered left of "More Actions". */
  children?: ReactNode;
  className?: string;
}

/**
 * Standard page header: bold title top-left, muted "More Actions"
 * dropdown and a vibrant green primary action top-right.
 */
const PageHeader = ({
  title,
  description,
  actionLabel,
  onAction,
  actionIcon,
  moreActions,
  children,
  className,
}: PageHeaderProps) => (
  <div
    className={cn(
      "flex flex-wrap items-start justify-between gap-3 border-b border-border bg-background px-4 py-4 sm:px-6",
      className
    )}
  >
    <div className="min-w-0">
      <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
        {title}
      </h1>
      {description && (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      )}
    </div>

    <div className="flex items-center gap-3">
      {children}

      {moreActions && (
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            More Actions
            <ChevronDown className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">{moreActions}</DropdownMenuContent>
        </DropdownMenu>
      )}

      {actionLabel && (
        <Button variant="brand" onClick={onAction}>
          {actionIcon}
          {actionLabel}
        </Button>
      )}
    </div>
  </div>
);

export default PageHeader;
