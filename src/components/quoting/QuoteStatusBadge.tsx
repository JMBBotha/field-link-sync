import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const statusConfig: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground border-border" },
  sent: { label: "Sent", className: "bg-blue-100 text-blue-800 border-blue-200" },
  viewed: { label: "Viewed", className: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  accepted: { label: "Accepted", className: "bg-green-100 text-green-800 border-green-200" },
  declined: { label: "Declined", className: "bg-red-100 text-red-800 border-red-200" },
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
