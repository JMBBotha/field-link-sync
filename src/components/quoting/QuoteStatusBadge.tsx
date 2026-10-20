import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const statusConfig: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground border-border" },
  sent: { label: "Sent", className: "bg-blue-100 dark:bg-blue-500/15 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-400/30" },
  viewed: { label: "Viewed", className: "bg-yellow-100 dark:bg-yellow-500/15 text-yellow-800 dark:text-yellow-300 border-yellow-200 dark:border-yellow-400/30" },
  accepted: { label: "Accepted", className: "bg-green-100 dark:bg-green-500/15 text-green-800 dark:text-green-300 border-green-200 dark:border-green-400/30" },
  declined: { label: "Declined", className: "bg-red-100 dark:bg-red-500/15 text-red-800 dark:text-red-300 border-red-200 dark:border-red-400/30" },
};

interface QuoteStatusBadgeProps {
  status: string;
  className?: string;
}

const QuoteStatusBadge = ({ status, className }: QuoteStatusBadgeProps) => {
  const config = statusConfig[status] || statusConfig.draft;
  return (
    <Badge variant="outline" className={cn(config.className, className)}>
      {config.label}
    </Badge>
  );
};

export default QuoteStatusBadge;
