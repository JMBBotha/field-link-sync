import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useLayoutVersion } from "@/hooks/useLayoutVersion";
import V8Sidebar, { useV8Role } from "./V8Sidebar";
import V8BottomNav from "./V8BottomNav";
import { useState } from "react";
import { V8BarContext } from "./v8BarContext";
import { useLocation } from "react-router-dom";
import BackButton from "@/components/shared/BackButton";
import CompanyLogo from "@/components/shared/CompanyLogo";
import { V8_HEADER_LOGO_CLASS, V8_HEADER_ROW_CLASS } from "@/components/shared/v8HeaderLogo";
import { isRootPath } from "@/lib/backNav";

/** v8 Simple: tech /field pages inside the same shell (New layout, techs only). Classic, admins and dispatchers see the page as before. */
export default function V8FieldShell({ children }: { children: React.ReactNode }) {
  const { isClassic } = useLayoutVersion();
  const role = useV8Role();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const mapHero = pathname === "/field" || /^\/field\/jobs\/[^/]+$/.test(pathname);
  if (isClassic || role !== "tech") return <>{children}</>;
  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-background" data-testid="v8-field-shell">
      <header data-testid="v8-field-top-bar" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }} className="v8-bar-over-halo v8-bar-hdr shrink-0 border-b z-20 bg-[var(--v8-bar)] border-[var(--v8-bar-bd)] dark:bg-[#0b1a2e] dark:border-white/10">
        <div className={V8_HEADER_ROW_CLASS}>
          {!isRootPath(pathname) && <BackButton />}
          <CompanyLogo data-testid="header-logo" className={V8_HEADER_LOGO_CLASS} />
        </div>
      </header>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <V8Sidebar onCreateLead={() => {}} onSignOut={async () => { await supabase.auth.signOut(); navigate("/login"); }} mobileOpen={open} onMobileClose={() => setOpen(false)} />
        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <main data-scroll-root data-testid={mapHero ? "map-hero-frame" : undefined} className={mapHero ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "min-h-0 flex-1 overflow-auto scroll-bounce scroll-room"}><V8BarContext.Provider value={true}>{children}</V8BarContext.Provider></main>
          <V8BottomNav onOpenMenu={() => setOpen(true)} />
        </div>
      </div>
    </div>
  );
}
