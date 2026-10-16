import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useLayoutVersion } from "@/hooks/useLayoutVersion";
import V8Sidebar, { useV8Role } from "./V8Sidebar";
import V8BottomNav from "./V8BottomNav";
import { useState } from "react";

/** v8 Simple: tech /field pages inside the same shell (New layout, techs only). Classic, admins and dispatchers see the page as before. */
export default function V8FieldShell({ children }: { children: React.ReactNode }) {
  const { isClassic } = useLayoutVersion();
  const role = useV8Role();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  if (isClassic || role !== "tech") return <>{children}</>;
  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-background" data-testid="v8-field-shell">
      <V8Sidebar onCreateLead={() => {}} onSignOut={async () => { await supabase.auth.signOut(); navigate("/login"); }} mobileOpen={open} onMobileClose={() => setOpen(false)} />
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <main className="min-h-0 flex-1 overflow-auto pb-20 lg:pb-0">{children}</main>
        <V8BottomNav onOpenMenu={() => setOpen(true)} />
      </div>
    </div>
  );
}
