import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { checkKindOf } from "@/lib/materialCheck";
import { useMaterialCheck } from "@/components/v8/roleHome/data";
import { assembleWeekStock, formatJobWhen, unitLinesFromSources } from "@/lib/jobPurchaseOrder";
import { loadJobPos } from "@/lib/jobPurchaseOrderLoad";
import { UnitOrderJobs } from "@/components/purchasing/StockOrdersCard";
import { PurchaseOrderPreview } from "@/components/purchasing/PurchaseOrderPreview";
import { useUnitPurchaseOrder } from "@/components/purchasing/useUnitPurchaseOrder";

type ItemRow = {
  id: string;
  item_name: string | null;
  product_id: string | null;
  supplier_products: { product_type: string | null; product_code: string | null; short_name: string | null } | { product_type: string | null; product_code: string | null; short_name: string | null }[] | null;
};

function productOf(row: ItemRow) {
  const product = Array.isArray(row.supplier_products) ? row.supplier_products[0] : row.supplier_products;
  return product || null;
}

/** Stock on the job page: the same short units, and the same purchase order, as the home card. */
export default function JobUnitStockSection({
  jobId,
  quoteId,
  companyId,
  client,
  title,
  scheduledFor,
  jobType,
  enabled,
}: {
  jobId: string;
  quoteId?: string | null;
  companyId?: string | null;
  client?: string | null;
  title?: string | null;
  scheduledFor?: string | null;
  jobType?: string | null;
  enabled: boolean;
}) {
  const kind = checkKindOf({ jobType, title });
  const check = useMaterialCheck(jobId, enabled ? kind : "quote_visit", quoteId);
  const order = useUnitPurchaseOrder();
  const items = useQuery({
    queryKey: ["job-unit-quote-items", quoteId],
    enabled: enabled && !!quoteId && kind === "installation",
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as {
        from: (table: string) => { select: (cols: string) => { eq: (col: string, value: string) => Promise<{ data: unknown; error: { message?: string } | null }> } };
      }).from("quote_items")
        .select("id, item_name, product_id, supplier_products(product_type, product_code, short_name)")
        .eq("quote_id", quoteId as string);
      if (error) throw error;
      return (data || []) as ItemRow[];
    },
  });
  const pos = useQuery({
    queryKey: ["job-unit-pos", jobId],
    enabled: enabled && !!jobId && !!companyId,
    queryFn: async () => loadJobPos(companyId as string, [jobId]),
  });
  if (!enabled || kind !== "installation" || !companyId || !check.data) return null;
  const sources = (items.data || []).map((row) => {
    const product = productOf(row);
    return {
      id: row.id,
      name: row.item_name,
      productId: row.product_id,
      productType: product?.product_type || null,
      code: product?.product_code || null,
    };
  });
  const units = unitLinesFromSources(check.data, sources);
  const view = assembleWeekStock(companyId, [{
    jobId,
    href: `/admin/jobs/${jobId}`,
    companyId,
    client: client || "Job",
    title: title || "Install",
    scheduledFor: scheduledFor || null,
    kind,
    check: check.data,
    unitLines: units.unitLines,
    productByLine: units.productByLine,
  }], pos.data || []);
  if (!view.unitRows.length && !order.drafts) return null;
  return (
    <Card className="rounded-2xl" data-testid="job-stock-section">
      <CardContent className="p-4 md:p-5">
        <h3 className="font-semibold">Stock</h3>
        <p className="text-xs text-muted-foreground">Units not in stock for this install. {formatJobWhen(scheduledFor)}</p>
        <UnitOrderJobs rows={view.unitRows} onCreate={order.open} onReview={order.open} busyJobId={order.busyJobId} />
        {order.drafts && (
          <PurchaseOrderPreview
            companyName={order.companyName}
            drafts={order.drafts}
            emails={order.emails}
            onEmails={(poId, value) => order.setEmails((current) => ({ ...current, [poId]: value }))}
            onSend={order.send}
            onClose={order.close}
            sending={order.sending}
            missingPrice={order.missingPrice}
          />
        )}
      </CardContent>
    </Card>
  );
}
