import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useLayoutVersion } from "@/hooks/useLayoutVersion";
import V8Sidebar, { useV8Role } from "./V8Sidebar";
import V8BottomNav from "./V8BottomNav";
import { useState } from "react";
import { V8BarContext } from "./v8BarContext";
import { useLocation } from "react-router-dom";
import BackButton from "@/components/shared/BackButton";
import { isRootPath } from "@/lib/backNav";

/** v8 Simple: tech /field pages inside the same shell (New layout, techs only). Classic, admins and dispatchers see the page as before. */
export default function V8FieldShell({ children }: { children: React.ReactNode }) {
  const { isClassic } = useLayoutVersion();
  const role = useV8Role();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  if (isClassic || role !== "tech") return <>{children}</>;
  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-background" data-testid="v8-field-shell">
      <V8Sidebar onCreateLead={() => {}} onSignOut={async () => { await supabase.auth.signOut(); navigate("/login"); }} mobileOpen={open} onMobileClose={() => setOpen(false)} />
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        {!isRootPath(pathname) && (
          <header data-testid="v8-field-back-bar" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }} className="v8-bar-hdr shrink-0 border-b z-20 bg-[var(--v8-bar)] border-[var(--v8-bar-bd)] dark:bg-[#0b1a2e] dark:border-white/10">
            <div className="flex h-12 items-center px-1"><BackButton /></div>
          </header>
        )}
        <main data-scroll-root className="min-h-0 flex-1 overflow-auto scroll-bounce scroll-room"><V8BarContext.Provider value={true}>{children}</V8BarContext.Provider></main>
        <V8BottomNav onOpenMenu={() => setOpen(true)} />
      </div>
    </div>
  );
}
