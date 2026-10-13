import { useNavigate } from "react-router-dom";
import { Menu, Sun, Moon, Search, Sparkle, Plus, MoreVertical, FileText, Receipt, Bell as BellIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import NotificationBell from "@/components/notifications/NotificationBell";
import { StatusUndoButton } from "@/components/shared/StatusUndo";
import CompanyLogo from "@/components/shared/CompanyLogo";
import IdentityBadge from "@/components/IdentityBadge";
import { openMandyVoice } from "@/lib/mandy/registry";
import { useRole } from "@/hooks/useRole";
import { useSalesRep } from "@/hooks/useSalesRep";

/** v7 header (NEW layout only; Classic keeps its own header in AdminLayout). Same actions, new arrangement:
 *  title · wide search (⌘K) · Ask Mandy · undo · bell · theme · orange "+ New" · who chip. */
export default function NewAdminHeader({ pageTitle, onMenu, onSearch, onCreateLead, resolvedTheme, toggleTheme }: {
  pageTitle: string; onMenu: () => void; onSearch: () => void; onCreateLead: () => void; resolvedTheme: string; toggleTheme: () => void;
}) {
  const navigate = useNavigate();
  const { isAdmin, isDispatcher, isFieldAgent } = useRole();
  const { isSalesRep } = useSalesRep();
  const techOnly = isFieldAgent && !isAdmin && !isDispatcher;
  const ghost = "text-white/90 hover:bg-white/10 hover:text-white";
  return (
    <header data-testid="v7-header" className="shrink-0 h-14 border-b flex items-center gap-2 px-2 sm:px-4 z-20 bg-[#1AA7EC] border-[#1590D6] dark:bg-[#0b1a2e] dark:border-white/10">
      <Button variant="ghost" size="icon" onClick={onMenu} className={`lg:hidden shrink-0 h-9 w-9 ${ghost}`} aria-label="Menu"><Menu className="h-5 w-5" /></Button>
      <CompanyLogo data-testid="header-logo" className="hidden min-[360px]:block h-6 w-auto max-w-[64px] object-contain object-left sm:h-8 lg:hidden" />
      <h1 className="hidden min-[400px]:block min-w-0 truncate text-base sm:text-lg font-bold text-white">{pageTitle}</h1>

      <button onClick={onSearch} title="Search (⌘K)" data-testid="v7-search"
        className="ml-2 hidden md:flex h-9 flex-1 max-w-md items-center gap-2 rounded-lg border border-white/25 bg-white/15 px-3 text-left text-sm text-white/85 hover:bg-white/20">
        <Search className="h-4 w-4" /><span className="flex-1 truncate">Search clients, jobs, quotes…</span>
        <kbd className="rounded border border-white/30 bg-white/10 px-1.5 py-0.5 text-[10px]">⌘K</kbd>
      </button>

      <div className="ml-auto flex items-center gap-0.5 sm:gap-1.5 shrink-0">
        <Button variant="ghost" size="icon" onClick={onSearch} className={`md:hidden h-9 w-9 ${ghost}`} aria-label="Search"><Search className="h-4 w-4" /></Button>
        <Button variant="ghost" size="sm" onClick={() => openMandyVoice()} className={`hidden sm:inline-flex gap-1.5 ${ghost}`} title="Talk to the operations assistant">
          <Sparkle className="h-4 w-4" /><span className="text-xs">Ask Mandy</span>
        </Button>
        <StatusUndoButton />
        <NotificationBell />
        <Button variant="ghost" size="icon" onClick={toggleTheme} className={`hidden sm:inline-flex h-9 w-9 ${ghost}`} title={resolvedTheme === "light" ? "Switch to dark mode" : "Switch to light mode"}>
          {resolvedTheme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </Button>
        {!techOnly && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" data-testid="v7-new-menu" className="hidden sm:inline-flex h-8 gap-1 bg-[#F97316] text-white hover:bg-[#ea6a0c]"><Plus className="h-4 w-4" />New</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onCreateLead}><BellIcon className="mr-2 h-4 w-4" />New lead</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/admin/quote-builder")}><FileText className="mr-2 h-4 w-4" />New quote</DropdownMenuItem>
              {!isSalesRep && <DropdownMenuItem onClick={() => navigate("/admin/invoices")}><Receipt className="mr-2 h-4 w-4" />Invoice (from Invoices)</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <IdentityBadge />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="More" data-testid="header-more" className={`sm:hidden h-9 w-8 ${ghost}`}><MoreVertical className="h-4 w-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!techOnly && <DropdownMenuItem onClick={onCreateLead}><Plus className="mr-2 h-4 w-4" />New lead</DropdownMenuItem>}
            <DropdownMenuItem onClick={() => openMandyVoice()}><Sparkle className="mr-2 h-4 w-4" />Ask Mandy</DropdownMenuItem>
            <DropdownMenuItem onClick={toggleTheme}>
              {resolvedTheme === "light" ? <Moon className="mr-2 h-4 w-4" /> : <Sun className="mr-2 h-4 w-4" />}
              {resolvedTheme === "light" ? "Dark mode" : "Light mode"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
