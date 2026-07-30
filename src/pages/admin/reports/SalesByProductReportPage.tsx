import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronDown, ChevronRight } from "lucide-react";
import ReportShell from "@/components/reports/ReportShell";
import { formatRand } from "@/utils/formatRand";

interface ProductRow {
  product_description: string | null;
  invoice_count: number | null;
  total_quantity: number | null;
  total_sales: number | null;
}

interface DetailRow {
  invoice_id: string;
  invoice_number: string | null;
  issue_date: string | null;
  status: string | null;
  product_description: string | null;
  quantity: number | null;
  unit_price: number | null;
  line_amount: number | null;
}

const SalesByProductReportPage = () => {
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["v_sales_by_product"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_sales_by_product" as any)
        .select("*")
        .order("total_sales", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as ProductRow[];
    },
  });

  const { data: details = [] } = useQuery({
    queryKey: ["v_sales_by_product_detail", expanded],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_sales_by_product_detail" as any)
        .select("*")
        .eq("product_description", expanded!)
        .order("issue_date", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as DetailRow[];
    },
    enabled: !!expanded,
  });

  const totals = useMemo(
    () =>
      products.reduce(
        (acc, p) => ({
          qty: acc.qty + Number(p.total_quantity || 0),
          sales: acc.sales + Number(p.total_sales || 0),
        }),
        { qty: 0, sales: 0 }
      ),
    [products]
  );

  const exportRows = products.map((p) => ({
    Product: p.product_description || "Unspecified",
    Invoices: p.invoice_count || 0,
    "Qty sold": Number(p.total_quantity || 0),
    Revenue: Number(p.total_sales || 0).toFixed(2),
  }));

  return (
    <ReportShell
      title="Sales by Product"
      subtitle="Quantity sold and revenue per product or service. Click a row to see the individual invoice lines."
      exportRows={exportRows}
      exportFilename="sales-by-product"
    >
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/60">
            <TableHead className="w-8" />
            <TableHead>Product / Service</TableHead>
            <TableHead className="text-right">Invoices</TableHead>
            <TableHead className="text-right">Qty sold</TableHead>
            <TableHead className="text-right">Revenue</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                Loading…
              </TableCell>
            </TableRow>
          ) : products.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                No product sales recorded yet.
              </TableCell>
            </TableRow>
          ) : (
            <>
              {products.map((p) => {
                const key = p.product_description || "Unspecified";
                const isOpen = expanded === key;
                return (
                  <Fragment key={key}>
                    <TableRow className="cursor-pointer" onClick={() => setExpanded(isOpen ? null : key)}>
                      <TableCell>
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </TableCell>
                      <TableCell className="font-medium">{key}</TableCell>
                      <TableCell className="text-right tabular-nums">{p.invoice_count || 0}</TableCell>
                      <TableCell className="text-right tabular-nums">{Number(p.total_quantity || 0)}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatRand(Number(p.total_sales || 0))}
                      </TableCell>
                    </TableRow>
                    {isOpen && (
                      <TableRow>
                        <TableCell colSpan={5} className="bg-muted/30 p-0">
                          <Table>
                            <TableHeader>
                              <TableRow className="bg-muted/50">
                                <TableHead>Invoice</TableHead>
                                <TableHead>Date</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Qty</TableHead>
                                <TableHead className="text-right">Unit price</TableHead>
                                <TableHead className="text-right">Line total</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {details.length === 0 ? (
                                <TableRow>
                                  <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                                    No line items found.
                                  </TableCell>
                                </TableRow>
                              ) : (
                                details.map((d, i) => (
                                  <TableRow key={`${d.invoice_id}-${i}`}>
                                    <TableCell>{d.invoice_number || "—"}</TableCell>
                                    <TableCell>{d.issue_date || "—"}</TableCell>
                                    <TableCell>{d.status || "—"}</TableCell>
                                    <TableCell className="text-right tabular-nums">{Number(d.quantity || 0)}</TableCell>
                                    <TableCell className="text-right tabular-nums">
                                      {formatRand(Number(d.unit_price || 0))}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                      {formatRand(Number(d.line_amount || 0))}
                                    </TableCell>
                                  </TableRow>
                                ))
                              )}
                            </TableBody>
                          </Table>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
              <TableRow className="bg-muted/40 font-semibold">
                <TableCell />
                <TableCell>Total</TableCell>
                <TableCell />
                <TableCell className="text-right tabular-nums">{totals.qty}</TableCell>
                <TableCell className="text-right tabular-nums">{formatRand(totals.sales)}</TableCell>
              </TableRow>
            </>
          )}
        </TableBody>
      </Table>
    </ReportShell>
  );
};

export default SalesByProductReportPage;
