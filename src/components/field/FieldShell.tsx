import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, CloudOff, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import CompanyLogo from "@/components/shared/CompanyLogo";
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
          <h1 className="min-w-0 flex-1 break-words text-xl font-bold text-foreground">{title}</h1>
          <Badge variant="outline" className="gap-1 text-muted-foreground" role="status">
            {isOnline ? <Wifi className="h-3 w-3" /> : <CloudOff className="h-3 w-3" />}
            {isOnline ? "Online" : "Offline"}
          </Badge>
        </div>
      </header>
      <main className="mx-auto max-w-3xl p-4 pb-32">{children}</main>
      <FieldAgentBottomNav />
    </div>
  );
}