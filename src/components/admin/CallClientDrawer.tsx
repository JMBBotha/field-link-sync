import { useState } from "react";
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerFooter, DrawerClose,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Phone, Bot, ExternalLink } from "lucide-react";
import { useInvoiceAgentContext } from "@/hooks/useInvoiceAgentContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";

interface Props {
  open: boolean;
  onClose: () => void;
  leadId: string | null;
  customerPhone: string;
}

const CallClientDrawer = ({ open, onClose, leadId, customerPhone }: Props) => {
  const { data: ctx, isLoading } = useInvoiceAgentContext(leadId);
  const [calling, setCalling] = useState(false);

  const logCall = async (method: "ai" | "manual") => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !ctx) return;
    await supabase.from("communication_log").insert({
      lead_id: ctx.lead.id,
      agent_id: user.id,
      type: "call",
      subject: `${method === "ai" ? "AI" : "Manual"} call attempt`,
      body: `Status: ${ctx.suggested_action}. ${ctx.script_hints.join("; ")}`,
    });
  };

  const handleAICall = async () => {
    setCalling(true);
    try {
      const { error } = await supabase.functions.invoke("create-reminder-call", {
        body: ctx,
      });
      if (error) throw error;
      await logCall("ai");
      toast.success("AI call initiated");
      onClose();
    } catch (e: any) {
      toast.error("Failed to start call", { description: e.message });
    } finally {
      setCalling(false);
    }
  };

  const handleManualCall = async () => {
    await logCall("manual");
    window.open(`tel:${customerPhone}`, "_self");
    toast.success("Opening dialer");
    onClose();
  };

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader>
          <DrawerTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5" /> Call Client
          </DrawerTitle>
          <DrawerDescription>Review context before calling</DrawerDescription>
        </DrawerHeader>

        <div className="px-4 pb-4 space-y-4 overflow-y-auto">
          {isLoading || !ctx ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : (
            <>
              {/* Client Info */}
              <section className="space-y-1">
                <h4 className="text-sm font-semibold text-muted-foreground">Client</h4>
                <p className="text-sm font-medium">{ctx.client.name}</p>
                <p className="text-xs text-muted-foreground">{ctx.client.phone}</p>
                <p className="text-xs text-muted-foreground">{ctx.client.address}</p>
              </section>

              {/* Invoice Summary */}
              {ctx.invoice ? (
                <section className="space-y-1 rounded-lg border p-3">
                  <h4 className="text-sm font-semibold text-muted-foreground">Invoice</h4>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">#{ctx.invoice.number}</span>
                    <Badge variant={ctx.invoice.status === "paid" ? "default" : "destructive"} className="text-xs">
                      {ctx.invoice.status}
                    </Badge>
                  </div>
                  <p className="text-sm">
                    R {ctx.invoice.amount.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                  </p>
                  {ctx.invoice.due_date && (
                    <p className="text-xs text-muted-foreground">
                      Due: {format(new Date(ctx.invoice.due_date), "dd MMM yyyy")}
                      {ctx.invoice.days_overdue > 0 && (
                        <span className="text-destructive ml-1">({ctx.invoice.days_overdue}d overdue)</span>
                      )}
                    </p>
                  )}
                </section>
              ) : (
                <section className="rounded-lg border border-dashed p-3 text-center">
                  <p className="text-xs text-muted-foreground">No invoice created yet</p>
                </section>
              )}

              {/* Lead Summary */}
              <section className="space-y-1">
                <h4 className="text-sm font-semibold text-muted-foreground">Job</h4>
                <p className="text-sm">{ctx.lead.service_type}</p>
                {ctx.lead.completion_date && (
                  <p className="text-xs text-muted-foreground">
                    Completed: {format(new Date(ctx.lead.completion_date), "dd MMM yyyy")}
                  </p>
                )}
                {ctx.lead.notes && <p className="text-xs text-muted-foreground">{ctx.lead.notes}</p>}
              </section>

              {/* Talking Points */}
              <section className="space-y-1">
                <h4 className="text-sm font-semibold text-muted-foreground">Suggested Talking Points</h4>
                <ul className="list-disc list-inside space-y-0.5">
                  {ctx.script_hints.map((hint, i) => (
                    <li key={i} className="text-xs text-muted-foreground">{hint}</li>
                  ))}
                </ul>
              </section>

              {ctx.last_contact && (
                <p className="text-xs text-muted-foreground">
                  Last contact: {format(new Date(ctx.last_contact), "dd MMM yyyy HH:mm")}
                </p>
              )}
            </>
          )}
        </div>

        <DrawerFooter className="flex-row gap-2">
          <Button onClick={handleAICall} disabled={calling || !ctx} className="flex-1 gap-2">
            <Bot className="h-4 w-4" /> {calling ? "Starting…" : "Start AI Call"}
          </Button>
          <Button variant="outline" onClick={handleManualCall} disabled={!customerPhone} className="flex-1 gap-2">
            <ExternalLink className="h-4 w-4" /> Call Manually
          </Button>
          <DrawerClose asChild>
            <Button variant="ghost" size="sm">Cancel</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
};

export default CallClientDrawer;
