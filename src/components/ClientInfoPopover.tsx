import { useState } from "react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Badge } from "@/components/ui/badge";
import { Loader2, User, Phone, Mail, MapPin, FileText, Receipt, Star } from "lucide-react";
import RandSign from "@/components/icons/RandSign";
import { useClientDetails } from "@/hooks/useUnifiedClients";
import { formatDistanceToNow } from "date-fns";

interface ClientInfoPopoverProps {
  customerId: string | null;
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}

const formatZAR = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

const ClientInfoPopover = ({ customerId, children, side = "bottom" }: ClientInfoPopoverProps) => {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useClientDetails(open ? customerId : null);

  if (!customerId) return <>{children}</>;

  return (
    <HoverCard openDelay={300} closeDelay={200} open={open} onOpenChange={setOpen}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent side={side} className="w-80 p-0 bg-popover border shadow-xl z-50">
        {isLoading || !data?.customer ? (
          <div className="flex items-center justify-center p-6">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : (
          <div className="space-y-0">
            {/* Header */}
            <div className="p-4 border-b bg-primary/5">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary/15 flex items-center justify-center">
                  <User className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{data.customer.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Client since {formatDistanceToNow(new Date(data.customer.created_at), { addSuffix: true })}
                  </p>
                </div>
                {data.avgRating && (
                  <div className="flex items-center gap-1 text-sm">
                    <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                    <span className="font-medium">{data.avgRating.toFixed(1)}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Contact Info */}
            <div className="px-4 py-2.5 space-y-1.5 border-b">
              <div className="flex items-center gap-2 text-xs">
                <Phone className="h-3 w-3 text-muted-foreground shrink-0" />
                <span>{data.customer.phone}</span>
              </div>
              {data.customer.email && (
                <div className="flex items-center gap-2 text-xs">
                  <Mail className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="truncate">{data.customer.email}</span>
                </div>
              )}
              {data.customer.address && (
                <div className="flex items-center gap-2 text-xs">
                  <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="truncate">{data.customer.address}</span>
                </div>
              )}
            </div>

            {/* Stats Row */}
            <div className="grid grid-cols-3 divide-x border-b">
              <div className="p-2.5 text-center">
                <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                  <FileText className="h-3 w-3" />
                  Quotes
                </div>
                <p className="text-sm font-bold mt-0.5">{data.quotes.length}</p>
              </div>
              <div className="p-2.5 text-center">
                <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                  <Receipt className="h-3 w-3" />
                  Jobs
                </div>
                <p className="text-sm font-bold mt-0.5">{data.leads.length}</p>
              </div>
              <div className="p-2.5 text-center">
                <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground">
                  <RandSign className="h-3 w-3" />
                  Revenue
                </div>
                <p className="text-sm font-bold mt-0.5">{formatZAR(data.totalRevenue)}</p>
              </div>
            </div>

            {/* Recent Activity */}
            {data.quotes.length > 0 && (
              <div className="px-4 py-2.5">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">Recent Quotes</p>
                <div className="space-y-1">
                  {data.quotes.slice(0, 3).map((q) => (
                    <div key={q.id} className="flex items-center justify-between text-xs">
                      <span className="font-medium">{q.quote_number}</span>
                      <div className="flex items-center gap-1.5">
                        <span>{formatZAR(Number(q.total))}</span>
                        <Badge variant="outline" className="text-[9px] px-1 py-0">{q.status}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            {data.customer.notes && (
              <div className="px-4 py-2.5 border-t">
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1">Notes</p>
                <p className="text-xs text-muted-foreground line-clamp-2">{data.customer.notes}</p>
              </div>
            )}
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
};

export default ClientInfoPopover;
