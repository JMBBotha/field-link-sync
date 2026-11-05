import { DORMANT_BADGE } from "@/lib/companyStatus";

/** Shown when a platform admin opens a company whose status is archived (dormant / history only). */
export default function ArchivedCompanyBanner({ status }: { status?: string | null }) {
  if (status !== "archived") return null;
  return (
    <div
      role="status"
      data-testid="archived-company-banner"
      className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950 print:hidden"
    >
      <span className="mr-2 inline-flex items-center rounded-md border border-amber-400 bg-white px-2 py-0.5 text-xs font-semibold">
        {DORMANT_BADGE}
      </span>
      New quotes, jobs, dispatch and emails are blocked. Open invoices can still take payments until an admin locks them.
    </div>
  );
}
