import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Home, KanbanSquare, CalendarDays, Users, Wallet, Briefcase, MoreHorizontal, Bell, Plus, LogOut, X, ChevronDown,
  MapPin, PenLine, HelpCircle, Settings, BookOpen, FileText, Inbox, Phone, BarChart3, ShoppingBag, Package, Building2, Tag, Upload,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useRole } from "@/hooks/useRole";
import { useSalesRep } from "@/hooks/useSalesRep";
import { useIsMainCompany } from "@/hooks/useIsMainCompany";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { useSignedInIdentity } from "@/hooks/useSignedInIdentity";
import { usePlatformOwner } from "@/components/RequirePlatformOwner";
import { useLeadInbox, INBOX_ROUTE } from "@/hooks/useLeadInbox";
import { useLeadSla, useNow } from "@/hooks/useLeadSla";
import { usePendingApplicants } from "@/hooks/usePendingApplicants";
import { inboxTone } from "@/lib/leadClock";
import { span as hm } from "@/lib/leadFlow";
import LayoutToggleButton from "@/components/classic/LayoutToggleButton";
import logoWhite from "@/assets/fieldlynk-logo-white.png";
import logoCard from "@/assets/fieldlynk-logo-card.png";
import { v8RoleOf, v8Primary, v8More, v8IsActive, type V8Role } from "./v8Nav";
import "./v8.css";

export const V8_ICONS: Record<string, React.ElementType> = {
  home: Home, pipeline: KanbanSquare, calendar: CalendarDays, users: Users, wallet: Wallet, briefcase: Briefcase, pin: MapPin,
  pen: PenLine, bell: Bell, help: HelpCircle, settings: Settings, book: BookOpen, file: FileText, inbox: Inbox, phone: Phone,
  chart: BarChart3, bag: ShoppingBag, box: Package, building: Building2, tag: Tag, upload: Upload,
};

export function useV8Role(): V8Role {
  const { isAdmin, isDispatcher, isFieldAgent } = useRole();
  const { isSalesRep } = useSalesRep();
  const { isMain } = useIsMainCompany();
  const { isPlatformOwner } = usePlatformOwner();
  const role = v8RoleOf({ isAdmin, isDispatcher, isFieldAgent, isSalesRep, isMainCo: !!isMain });
  // Platform pages only for the platform owner on the main company.
  return role === "admin" && !isPlatformOwner ? "owner" : role;
}

interface Props {
  onCreateLead: () => void;
  onSignOut: () => void;
  pendingRequestsCount?: number;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

/** Field Lynk v8 Simple sidebar ("New" layout). Classic stays one click away via the layout toggle. */
export default function V8Sidebar({ onCreateLead, onSignOut, mobileOpen, onMobileClose }: Props) {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const role = useV8Role();
  const { settings } = useCompanySettings();
  const identity = useSignedInIdentity();
  const { count: inboxCount, leads } = useLeadInbox();
  const { sla } = useLeadSla();
  const now = useNow();
  const { count: pending } = usePendingApplicants();
  const [moreOpen, setMoreOpen] = useState(false);
  const tech = role === "tech";
  const tone = tech ? null : inboxTone(leads as any[], Math.floor(now / 30_000) * 30_000, sla);
  const primary = v8Primary(role);
  const more = v8More(role);
  const moreActive = more.some((g) => g.links.some((l) => v8IsActive(l, pathname, search))) && !primary.some((l) => v8IsActive(l, pathname, search));
  const go = (p: string) => { navigate(p); onMobileClose?.(); };
  const initials = (identity?.name || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
  const company = settings?.company_name?.trim() || "My Company";

  const body = (
    <div className="v8-side flex h-full flex-col" data-testid="v8-sidebar" data-role={role}>
      <div className="px-4 pt-4">
        <img src={logoWhite} alt="0800-BE-COOL! AC Super Service" className="v8-logo-dark w-full max-w-[170px] h-auto" />
        <img src={logoCard} alt="0800-BE-COOL! AC Super Service" className="v8-logo-light w-full max-w-[170px] h-auto rounded-xl" />
        <div className="mt-2 truncate text-sm font-bold" data-testid="v8-company">{company}</div>
        <div className="v8-user mt-2 flex items-center gap-2 rounded-xl p-2">
          <span className="v8-av flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold">{initials}</span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{identity?.name || ""}</div>
            <div className="truncate text-[11px] opacity-70">{{ admin: "Owner · admin", owner: "Company owner", sales: "Sales", tech: "Technician" }[role]}</div>
          </div>
        </div>
      </div>

      <nav className="mt-3 flex-1 overflow-y-auto px-2" aria-label="Main">
        {primary.map((l) => {
          const Icon = V8_ICONS[l.icon] ?? Home;
          const active = v8IsActive(l, pathname, search);
          return (
            <button key={l.label} type="button" onClick={() => go(l.path)} className={cn("v8-nav", active && "is-active")} aria-current={active ? "page" : undefined}>
              <Icon className="h-4 w-4" />{l.label}
            </button>
          );
        })}
        <button type="button" onClick={() => setMoreOpen((v) => !v)} className={cn("v8-nav", moreActive && "is-active")} aria-expanded={moreOpen} data-testid="v8-more">
          <MoreHorizontal className="h-4 w-4" />More
          {pending > 0 && role !== "sales" && <span className="v8-dot ml-auto">{pending}</span>}
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", pending > 0 ? "ml-1" : "ml-auto", moreOpen && "rotate-180")} />
        </button>
        {(moreOpen || moreActive) && (
          <div className="v8-more mt-1 space-y-2 pb-2">
            {more.map((g) => (
              <div key={g.title}>
                <div className="v8-eyebrow px-3 pt-2 pb-1">{g.title}</div>
                {g.links.map((l) => {
                  const Icon = V8_ICONS[l.icon] ?? FileText;
                  const active = v8IsActive(l, pathname, search);
                  return (
                    <button key={g.title + l.path} type="button" onClick={() => go(l.path)} className={cn("v8-sub", active && "is-active")}>
                      <Icon className="h-3.5 w-3.5" />{l.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </nav>

      <div className="space-y-2 px-3 pb-3 pt-2">
        {tech ? (
          <button type="button" className="v8-leads tone-blue" onClick={() => go("/admin/my-jobs")}><Briefcase className="h-4 w-4" />Job offers</button>
        ) : (
          <div className="flex gap-1.5">
            <button type="button" onClick={() => go(INBOX_ROUTE)} data-tone={tone?.tone ?? "none"} data-testid="v8-new-leads"
              className={cn("v8-leads flex-1", tone ? `tone-${tone.tone}` : "tone-blue")}>
              <Bell className="h-4 w-4 shrink-0" />
              <span className="flex min-w-0 flex-col items-start leading-tight">
                <span>{inboxCount > 0 ? `${inboxCount} new lead${inboxCount === 1 ? "" : "s"}` : "New leads"}</span>
                {tone && tone.oldestMs > 0 && <span className="text-[10px] opacity-90">{tone.tone === "red" ? "! " : ""}oldest {hm(tone.oldestMs)}</span>}
                {tone?.tone === "grey" && <span className="text-[10px] opacity-90">Starts {sla.open}</span>}
              </span>
            </button>
            <button type="button" className="v8-leads tone-blue w-10 justify-center px-0" onClick={() => { onCreateLead(); onMobileClose?.(); }} title="Create lead" aria-label="Create lead"><Plus className="h-4 w-4" /></button>
          </div>
        )}
        <LayoutToggleButton />
        <button type="button" onClick={onSignOut} className="v8-sub"><LogOut className="h-3.5 w-3.5" />Sign out</button>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block w-[232px] shrink-0 border-r v8-border">{body}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/35" onClick={onMobileClose} />
          <div className="v8-drawer absolute inset-y-0 left-0 w-[280px] max-w-[85vw] shadow-2xl">
            <button type="button" className="absolute right-2 top-2 rounded-full p-2" onClick={onMobileClose} aria-label="Close menu"><X className="h-5 w-5" /></button>
            {body}
          </div>
        </div>
      )}
    </>
  );
}
