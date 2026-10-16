import { useQuery } from "@tanstack/react-query";
import { Home, BarChart3, CalendarDays, Users, Wallet, MoreHorizontal } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import logoWhite from "@/assets/fieldlynk-logo-white.png";
import logoCard from "@/assets/fieldlynk-logo-card.png";

const NAV = [
  { path: "/admin", label: "Home", icon: Home },
  { path: "/admin/jobs?tab=pipeline", label: "Pipeline", icon: BarChart3 },
  { path: "/admin/schedule", label: "Schedule", icon: CalendarDays },
  { path: "/admin/customers", label: "Clients", icon: Users },
  { path: "/admin/quotes", label: "Money", icon: Wallet, active: true },
  { path: "/admin", label: "More", icon: MoreHorizontal },
];

/** PDF builder v1 sidebar (desktop only). Every link goes through the builder's unsaved-changes guard. */
export default function QuoteBuilderSidebar({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { session } = useAuth();
  const uid = session?.user.id;
  const me = useQuery({
    queryKey: ["qb-sidebar-me", uid],
    enabled: !!uid,
    queryFn: async () => {
      const { data: p } = await supabase.from("profiles").select("full_name, company_id").eq("id", uid!).maybeSingle();
      let company: string | null = null;
      if (p?.company_id) {
        const { data: c } = await supabase.from("companies").select("name").eq("id", p.company_id).maybeSingle();
        company = c?.name ?? null;
      }
      return { name: p?.full_name ?? "", company };
    },
  });
  const initials = (me.data?.name || "").split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  return (
    <aside className="fl-qb-side hidden lg:flex w-[200px] shrink-0 flex-col gap-3 p-3 print:hidden" data-testid="qb-sidebar" data-html2canvas-ignore data-pdf-hide>
      <img src={logoWhite} alt="0800-BE-COOL! AC Super Service" className="fl-logo-dark w-full h-auto" />
      <img src={logoCard} alt="0800-BE-COOL! AC Super Service" className="fl-logo-light w-full h-auto rounded-xl" />
      {me.data?.company && <div className="text-sm font-bold truncate">{me.data.company}</div>}
      {me.data?.name && (
        <div className="fl-qb-user flex items-center gap-2 rounded-xl p-2">
          <span className="fl-qb-av flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold">{initials}</span>
          <span className="truncate text-sm font-semibold">{me.data.name}</span>
        </div>
      )}
      <nav className="mt-2 flex flex-col gap-1">
        {NAV.map((n) => (
          <button key={n.label} type="button" onClick={() => onNavigate(n.path)}
            className={`fl-qb-nav flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-left ${n.active ? "is-active" : ""}`}>
            <n.icon className="h-4 w-4" />{n.label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
