import { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download } from "lucide-react";
import { exportToCSV } from "@/lib/csvExport";

interface DateRange {
  from: string;
  to: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
}

interface ReportShellProps {
  title: string;
  subtitle: string;
  dateRange?: DateRange;
  exportRows?: Record<string, any>[];
  exportFilename?: string;
  children: ReactNode;
}

/** Shared layout for report pages: bold left title, subtitle, filters, export, white content card. */
const ReportShell = ({ title, subtitle, dateRange, exportRows, exportFilename, children }: ReportShellProps) => (
  <div className="w-full space-y-6 p-4 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {exportRows && (
        <Button
          variant="outline"
          onClick={() => exportToCSV(exportRows, exportFilename || "report")}
          disabled={!exportRows.length}
        >
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      )}
    </div>

    {dateRange && (
      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-border bg-card p-4">
        <div>
          <Label className="text-xs">From</Label>
          <Input
            type="date"
            value={dateRange.from}
            onChange={(e) => dateRange.onFromChange(e.target.value)}
            className="w-44"
          />
        </div>
        <div>
          <Label className="text-xs">To</Label>
          <Input
            type="date"
            value={dateRange.to}
            onChange={(e) => dateRange.onToChange(e.target.value)}
            className="w-44"
          />
        </div>
      </div>
    )}

    <div className="rounded-lg border border-border bg-card">{children}</div>
  </div>
);

export default ReportShell;
