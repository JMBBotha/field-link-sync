import { useLocation, useNavigate } from "react-router-dom";
import { MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { v8Tabs, v8IsActive } from "./v8Nav";
import { useV8Role, V8_ICONS } from "./V8Sidebar";
import { useIsSalaried } from "@/hooks/usePayType";

/** v8 phone tabs: max 4 role areas + More (Quotes/Invoices top of the More drawer). */
export default function V8BottomNav({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const role = useV8Role();
  const salary = useIsSalaried();
  const tabs = v8Tabs(role, { salary });
  return (
    <nav className="v8-tabs lg:hidden fixed bottom-0 inset-x-0 z-40 h-16 border-t" style={{ paddingBottom: "env(safe-area-inset-bottom)" }} data-testid="v8-bottom-nav">
      <div className="grid h-full" style={{ gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0,1fr))` }}>
        {tabs.map((t) => {
          const Icon = V8_ICONS[t.icon];
          const active = v8IsActive(t, pathname, search);
          return (
            <button key={t.label} type="button" onClick={() => navigate(t.path)} className={cn("v8-tab", active && "is-active")}>
              <Icon className="h-5 w-5" /><span>{t.label.replace("My ", "")}</span>
            </button>
          );
        })}
        <button type="button" onClick={onOpenMenu} className="v8-tab"><MoreHorizontal className="h-5 w-5" /><span>More</span></button>
      </div>
    </nav>
  );
}
