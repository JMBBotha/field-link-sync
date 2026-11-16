/** Dev shots for the archive-gap preview. Numbers here are harness rows, not Massair. */
import { useSearchParams } from "react-router-dom";
import { ArchivedQuoteBanner } from "@/components/quoting/QuoteDeleteArchive";
import { PublicUnavailable } from "@/components/archive/PublicUnavailable";
import { OpenLeadsCard } from "@/components/v8/roleHome/OpenLeadsCard";
import { countSales } from "@/lib/yardView";
import { summariseInvoiceAging } from "@/lib/archiveGaps";
import "@/components/v8/v8.css";

const DEMO = "00000000-0000-4000-8000-0000000000aa";
const NOW = new Date("2026-11-16T10:00:00+02:00");

const sales = countSales({
  companyId: DEMO,
  now: NOW,
  leads: [{ id: "live-lead", company_id: DEMO, status: "pending", customer_name: "Still open", primary_intent: "sales", service_type: "installation" }],
  quotes: [
    { id: "kept", company_id: DEMO, status: "sent", total: 18600, created_at: "2026-11-02", sent_at: "2026-11-02", customer_name: "Harbour View", quote_number: "0001842", lead_id: "live-lead" },
    { id: "closed-quote", company_id: DEMO, status: "sent", total: 24000, created_at: "2026-11-01", sent_at: "2026-11-01", customer_name: "Closed lead quote", quote_number: "0001830", lead_id: "closed-lead" },
  ],
  leadClosure: { "closed-lead": { closed_at: "2026-11-14", dismissed_at: null }, "live-lead": { closed_at: null, dismissed_at: null } },
  leadService: { "live-lead": "installation" },
});

const aging = summariseInvoiceAging([
  { status: "overdue", due_date: "2026-10-01", outstanding: 12840 },
  { status: "sent", due_date: "2026-11-20", outstanding: 4500 },
  { status: "overdue", due_date: "2026-09-01", outstanding: 17710, archived_at: "2026-11-14" },
  { status: "void", due_date: "2026-08-01", outstanding: 900 },
  { status: "cancelled", due_date: "2026-07-01", outstanding: 300 },
], "2026-11-16");

export default function ArchiveGapsHarness() {
  const [params] = useSearchParams();
  const panel = params.get("panel") || "all";
  const show = (name: string) => panel === "all" || panel === name;
  return (
    <div className="v8-scope min-h-screen bg-[#E7EEF5] p-4 text-[#0F2A44]" data-testid="archive-gaps-harness">
      {show("banner") && (
        <section className="mx-auto mb-6 max-w-3xl space-y-3" data-testid="shot-banner">
          <h1 className="text-lg font-semibold">Archived quote</h1>
          <ArchivedQuoteBanner quote={{ archived_at: "2026-11-14T08:00:00+02:00", archive_reason: "Auto-archived: 45 days no activity" }} onUnarchive={() => {}} />
        </section>
      )}
      {show("public") && (
        <section data-testid="shot-public">
          <PublicUnavailable message="This quote is no longer available. Please contact us." />
        </section>
      )}
      {show("leads") && (
        <section className="mx-auto mb-6 max-w-3xl" data-testid="shot-leads">
          <h1 className="mb-2 text-lg font-semibold">Open leads after the lead was closed</h1>
          <p className="mb-3 text-sm text-[#3D5166]">The quote on the closed lead is gone. Harbour View is still here. The quote was not archived and its status did not change.</p>
          <OpenLeadsCard rows={sales.openLeadRows} />
        </section>
      )}
      {show("aging") && (
        <section className="mx-auto max-w-3xl" data-testid="shot-aging">
          <h1 className="mb-1 text-lg font-semibold">Invoice ageing</h1>
          <p className="mb-3 text-sm text-[#3D5166]">Archived invoice 0001771 and void or cancelled invoices are left out. This uses the same rule as get_invoice_aging_report.</p>
          <table className="w-full overflow-hidden rounded-2xl bg-white text-sm shadow-sm">
            <thead className="bg-[#0F2A44] text-left text-white">
              <tr>
                <th className="px-3 py-2 font-semibold">Bracket</th>
                <th className="px-3 py-2 text-right font-semibold">Invoices</th>
                <th className="px-3 py-2 text-right font-semibold">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {aging.map((row) => (
                <tr key={row.bracket} className="border-t border-[#D6E4EF]">
                  <td className="px-3 py-2">{row.bracket}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{row.count}</td>
                  <td className="px-3 py-2 text-right tabular-nums">R{row.outstanding.toLocaleString("en-ZA")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
