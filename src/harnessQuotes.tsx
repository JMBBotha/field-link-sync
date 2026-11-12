// Screenshot harness. Sample quote rows only. Nothing is downloaded and no client record is read.
import "./index.css";
import "./components/v8/v8.css";
import { createRoot } from "react-dom/client";
import { Checkbox } from "@/components/ui/checkbox";
import QuotePdfSelectionBar from "@/components/quoting/QuotePdfSelectionBar";
import { combinedQuotePdfName } from "@/lib/bulkQuotePdf";

const rows = [
  { ref: "Q-2026-9001", client: "Demo Client A", status: "Sent", amount: "R 12 400,00" },
  { ref: "Q-2026-9002", client: "Demo Client A", status: "Sent", amount: "R 8 250,00" },
  { ref: "Q-2026-9003", client: "Demo Client A", status: "Accepted", amount: "R 15 900,00" },
  { ref: "Q-2026-9004", client: "Demo Client A", status: "Draft", amount: "R 6 100,00" },
  { ref: "Q-2026-9005", client: "Demo Client A", status: "Sent", amount: "R 9 750,00" },
];

const progress = new URLSearchParams(window.location.search).get("progress") === "1";
const fileName = combinedQuotePdfName(rows.map((r) => r.client), new Date("2026-11-12T10:00:00Z"));

function RowCheck({ label }: { label: string }) {
  return (
    <span className="flex h-11 w-11 items-center justify-center">
      <Checkbox checked aria-label={`Select ${label}`} />
    </span>
  );
}

function QuotesHarness() {
  return (
    <main className="v8-scope min-h-screen bg-background p-3 sm:p-6" data-testid="quotes-pdf-harness">
      <p className="mb-3 rounded-lg bg-[#3D9BE8] px-3 py-2 text-sm font-semibold text-white">
        Demo harness, sample quotes. Nothing is downloaded and no client data is used.
      </p>
      <div className="v8-navy mb-4 px-4 py-4">
        <h1 className="text-2xl font-bold tracking-tight">Estimates and Proposals</h1>
        <p className="mt-1 text-sm">5 documents · sample file {fileName}</p>
      </div>
      <QuotePdfSelectionBar
        selectedCount={rows.length}
        quoteCount={rows.length}
        busy={progress}
        progress={progress ? { current: 3, total: 5 } : null}
        onDownload={() => undefined}
        onCancel={() => undefined}
      />
      <div className="mt-4 space-y-2 lg:hidden" data-testid="quotes-list-cards">
        {rows.map((row) => (
          <div key={row.ref} className="flex min-h-[56px] items-center gap-2 rounded-xl border border-border/60 bg-card px-2 py-2.5 shadow-sm">
            <RowCheck label={row.ref} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-semibold">{row.client}</div>
              <div className="mt-0.5 truncate text-sm text-muted-foreground">{row.status} · {row.amount} · {row.ref}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 hidden overflow-hidden rounded-xl border bg-card shadow-sm lg:block" data-testid="quotes-list-table">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="w-12 p-3" />
              <th className="p-3">Reference</th>
              <th className="p-3">Client</th>
              <th className="p-3">Status</th>
              <th className="p-3 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.ref} className="border-b last:border-0">
                <td className="p-2"><RowCheck label={row.ref} /></td>
                <td className="p-3 font-mono font-bold text-primary">{row.ref}</td>
                <td className="p-3">{row.client}</td>
                <td className="p-3">{row.status}</td>
                <td className="p-3 text-right font-bold">{row.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<QuotesHarness />);
