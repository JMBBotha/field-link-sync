import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useRole } from "@/hooks/useRole";
import { useSalesRep } from "@/hooks/useSalesRep";
import { usePlatformOwner } from "@/components/RequirePlatformOwner";
import { useCashHealthEnabled } from "@/hooks/useCashHealth";

/** One sidebar link, several pages: a tab strip above sibling routes (Johan 19 Oct: merge duplicate links into tabs). Old URLs keep working. */
type Gate = "all" | "admin" | "platform" | "cash";
export type SectionKey = "money" | "catalogue" | "extras" | "documents" | "reports";
const SECTIONS: Record<SectionKey, { path: string; label: string; gate?: Gate; search?: string }[]> = {
  money: [
    { path: "/admin/cash-health", label: "Cash-flow health", gate: "cash" },
    { path: "/admin/cashflow", label: "Cash flow & profit", gate: "admin" },
  ],
  catalogue: [
    { path: "/admin/catalog", label: "Catalogue" },
    { path: "/admin/price-lists", label: "Price lists" },
  ],
  extras: [
    { path: "/admin/oss-extras", label: "Extras", gate: "admin" },
    { path: "/admin/consumables", label: "Consumables" },
  ],
  documents: [
    { path: "/admin/pdf-documents", label: "PDF documents" },
    { path: "/admin/brochures", label: "Brochures" },
    { path: "/admin/unit-content", label: "Unit content", gate: "platform" },
  ],
  reports: [
    { path: "/admin/reports", label: "Reports" },
    { path: "/admin/reports/aging", label: "Accounts ageing" },
    { path: "/admin/reports/sales-by-client", label: "Sales by client" },
    { path: "/admin/reports/sales-by-product", label: "Sales by product" },
    { path: "/admin/reports/vat", label: "VAT" },
    { path: "/admin/analytics", label: "Analytics" },
  ],
};

export function sectionTabs(key: SectionKey) { return SECTIONS[key]; }

export default function V8SectionTabs({ section }: { section: SectionKey }) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const { isAdmin } = useRole();
  const { isSalesRep } = useSalesRep();
  const { isPlatformOwner } = usePlatformOwner();
  const cash = useCashHealthEnabled();
  const ok = (g: Gate = "all") => g === "all" || (g === "admin" && isAdmin) || (g === "platform" && isPlatformOwner) || (g === "cash" && isAdmin && cash.enabled);
  const tabs = SECTIONS[section].filter((t) => ok(t.gate));
  const isOn = (t: (typeof tabs)[number]) => pathname === t.path && (t.search ? search.includes(t.search) : !tabs.some((o) => o !== t && o.path === t.path && o.search && search.includes(o.search)));
  const show = tabs.length > 1 && !isSalesRep;
  return (
    <>
      {show && (
        <nav className="mx-auto mb-1 flex max-w-6xl gap-1 overflow-x-auto px-4 pt-3 md:px-6" role="tablist" data-testid={`section-tabs-${section}`}>
          {tabs.map((t) => (
            <button key={t.label} role="tab" type="button" aria-selected={isOn(t)} onClick={() => navigate(t.path + (t.search ? `?${t.search}` : ""))}
              className={cn("h-8 shrink-0 whitespace-nowrap rounded-lg px-3 text-sm font-semibold", isOn(t) ? "bg-[#1590d6] text-white" : "text-muted-foreground hover:bg-muted")}>{t.label}</button>
          ))}
        </nav>
      )}
      <Outlet />
    </>
  );
}
