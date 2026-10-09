/** Tech-facing status of a completed job (no invoice, no money): "Sent to office" / "Office has it". */
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export type TechRequestRow = { lead_id: string; status: string; as_quoted: boolean };

export function useMyInvoiceRequests(leadIds: string[]) {
  return useQuery({
    queryKey: ["my-invoice-requests", [...leadIds].sort().join(",")],
    enabled: leadIds.length > 0,
    queryFn: async () => {
      const { data, error } = await (supabase.from("invoice_requests" as never) as any)
        .select("lead_id, status, as_quoted, created_at").in("lead_id", leadIds).order("created_at", { ascending: false });
      if (error) throw error;
      const by: Record<string, TechRequestRow> = {};
      for (const r of (data || []) as TechRequestRow[]) if (!by[r.lead_id]) by[r.lead_id] = r;
      return by;
    },
  });
}

export function TechOfficeChip({ row, className }: { row?: TechRequestRow | null; className?: string }) {
  const approved = row?.status === "approved";
  return (
    <div data-testid="tech-office-status" className={cn(
      "flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium",
      approved ? "border-green-300 bg-green-50 text-green-900 dark:bg-green-950/30 dark:text-green-100"
        : "border-sky-300 bg-sky-50 text-sky-900 dark:bg-sky-950/30 dark:text-sky-100", className)}>
      {approved ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <Send className="h-4 w-4 shrink-0" />}
      <span>
        {approved ? "Office approved – invoicing done by the office"
          : row ? `Sent to office${row.as_quoted ? " · as quoted" : " · with extras"}`
          : "Done – the office handles the invoice"}
      </span>
    </div>
  );
}

export default function TechOfficeStatus({ leadId, className }: { leadId: string; className?: string }) {
  const { data } = useMyInvoiceRequests([leadId]);
  return <TechOfficeChip row={data?.[leadId]} className={className} />;
}
