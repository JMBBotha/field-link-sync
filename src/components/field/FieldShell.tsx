import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, CloudOff, Home, Wallet, Wifi } from "lucide-react";
import { NavLink } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import CompanyLogo from "@/components/shared/CompanyLogo";
import IdentityBadge from "@/components/IdentityBadge";
import RoleAccentStrip from "@/components/RoleAccentStrip";
import FieldAgentBottomNav from "@/components/FieldAgentBottomNav";
import { useOfflineContext } from "@/contexts/OfflineContext";

type FieldShellProps = {
  title: string;
  back?: boolean;
  children: ReactNode;
};

export default function FieldShell({ title, back = false, children }: FieldShellProps) {
  const navigate = useNavigate();
  const { isOnline } = useOfflineContext();
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 p-4">
          {back && <Button variant="ghost" size="icon" aria-label="Back" title="Back" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>}
          <CompanyLogo className="h-12 w-24 shrink-0 object-contain" />
          <span className="flex-1 sm:hidden" aria-hidden />
          <h1 className="order-last w-full min-w-0 break-words text-xl font-bold text-foreground sm:order-none sm:w-auto sm:flex-1">{title}</h1>
          {/* Desktop has no bottom nav: keep Field home and My earnings one click away (Johan 09:27). */}
          <nav className="hidden md:flex items-center gap-1" aria-label="Field pages">
            <NavLink to="/field" end className="flex items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-muted"><Home className="h-4 w-4" />Field home</NavLink>
            <NavLink to="/field/earnings" className={({ isActive }) => `flex items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-muted ${isActive ? "font-semibold text-primary" : ""}`}><Wallet className="h-4 w-4" />My earnings</NavLink>
          </nav>
          <IdentityBadge />
          <Badge variant="outline" className="gap-1 text-muted-foreground" role="status">
            {isOnline ? <Wifi className="h-3 w-3" /> : <CloudOff className="h-3 w-3" />}
            {isOnline ? "Online" : "Offline"}
          </Badge>
        </div>
      </header>
      <RoleAccentStrip />
      <main className="mx-auto max-w-3xl p-4 pb-32">{children}</main>
      <FieldAgentBottomNav />
    </div>
  );
}