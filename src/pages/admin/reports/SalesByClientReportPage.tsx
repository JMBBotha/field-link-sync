import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowUpDown } from "lucide-react";
import ReportShell from "@/components/reports/ReportShell";
import { formatRand } from "@/utils/formatRand";

interface ClientRow {
  customer_id: string | null;
  customer_name: string | null;
  invoice_count: number | null;
  total_excl_vat: number | null;
  total_vat: number | null;
  total_sales: number | null;
  total_paid: number | null;
  total_outstanding: number | null;
}

type SortKey = "customer_name" | "invoice_count" | "total_sales" | "total_outstanding";

const SalesByClientReportPage = () => {
  const [sortKey, setSortKey] = useState<SortKey>("total_sales");
  const [asc, setAsc] = useState(false);

  const { data = [], isLoading } = useQuery({
    queryKey: ["v_sales_by_client"],
    queryFn: async () => {
      const { data, error } = await supabase.from("v_sales_by_client" as any).select("*");
      if (error) throw error;
      return (data || []) as unknown as ClientRow[];
    },
  });

  const rows = useMemo(() => {
    const sorted = [...data].sort((a, b) => {
      if (sortKey === "customer_name") {
        return (a.customer_name || "").localeCompare(b.customer_name || "");
      }
      return Number(a[sortKey] || 0) - Number(b[sortKey] || 0);
    });
    return asc ? sorted : sorted.reverse();
  }, [data, sortKey, asc]);

  const toggle = (key: SortKey) => {
    if (key === sortKey) setAsc((v) => !v);
    else {
      setSortKey(key);
      setAsc(key === "customer_name");
    }
  };

  const totals = rows.reduce(
    (acc, r) => ({
      invoices: acc.invoices + Number(r.invoice_count || 0),
      sales: acc.sales + Number(r.total_sales || 0),
      paid: acc.paid + Number(r.total_paid || 0),
      outstanding: acc.outstanding + Number(r.total_outstanding || 0),
    }),
    { invoices: 0, sales: 0, paid: 0, outstanding: 0 }
  );

  const exportRows = rows.map((r) => ({
    Client: r.customer_name || "Unknown",
    Invoices: r.invoice_count || 0,
    "Excl VAT": Number(r.total_excl_vat || 0).toFixed(2),
    VAT: Number(r.total_vat || 0).toFixed(2),
    "Total invoiced": Number(r.total_sales || 0).toFixed(2),
    Paid: Number(r.total_paid || 0).toFixed(2),
    Outstanding: Number(r.total_outstanding || 0).toFixed(2),
  }));

  const SortHead = ({ label, k, align = "right" }: { label: string; k: SortKey; align?: "left" | "right" }) => (
    <TableHead className={align === "right" ? "text-right" : ""}>
      <button
        type="button"
        onClick={() => toggle(k)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${align === "right" ? "justify-end" : ""}`}
      >
        {label}
        <ArrowUpDown className="h-3 w-3" />
      </button>
    </TableHead>
  );

  return (
    <ReportShell
      title="Sales by Client"
      subtitle="Total revenue invoiced per client, including how much is paid and still outstanding."
      exportRows={exportRows}
      exportFilename="sales-by-client"
    >
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/60">
            <SortHead label="Client" k="customer_name" align="left" />
            <SortHead label="Invoices" k="invoice_count" />
            <TableHead className="text-right">Excl. VAT</TableHead>
            <TableHead className="text-right">VAT</TableHead>
            <SortHead label="Total invoiced" k="total_sales" />
            <TableHead className="text-right">Paid</TableHead>
            <SortHead label="Outstanding" k="total_outstanding" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                Loading…
              </TableCell>
            </TableRow>
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                No sales recorded yet.
              </TableCell>
            </TableRow>
          ) : (
            <>
              {rows.map((r) => (
                <TableRow key={r.customer_id || r.customer_name}>
                  <TableCell className="font-medium">{r.customer_name || "Unknown client"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.invoice_count || 0}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatRand(Number(r.total_excl_vat || 0))}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatRand(Number(r.total_vat || 0))}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {formatRand(Number(r.total_sales || 0))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatRand(Number(r.total_paid || 0))}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatRand(Number(r.total_outstanding || 0))}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/40 font-semibold">
                <TableCell>Total</TableCell>
                <TableCell className="text-right tabular-nums">{totals.invoices}</TableCell>
                <TableCell />
                <TableCell />
                <TableCell className="text-right tabular-nums">{formatRand(totals.sales)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatRand(totals.paid)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatRand(totals.outstanding)}</TableCell>
              </TableRow>
            </>
          )}
        </TableBody>
      </Table>
    </ReportShell>
  );
};

export default SalesByClientReportPage;
