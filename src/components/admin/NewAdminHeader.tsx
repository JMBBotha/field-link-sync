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
import { MyAvailabilitySwitch } from "@/components/availability/AvailabilitySwitch";

/** v7 header (NEW layout only; Classic keeps its own header in AdminLayout). Same actions, new arrangement:
 *  title · wide search (⌘K) · Ask Mandy · undo · bell · theme · orange "+ New" · who chip. */
export default function NewAdminHeader({ pageTitle, onMenu, onSearch, onCreateLead, resolvedTheme, toggleTheme }: {
  pageTitle: string; onMenu: () => void; onSearch: () => void; onCreateLead: () => void; resolvedTheme: string; toggleTheme: () => void;
}) {
  const navigate = useNavigate();
  const { isAdmin, isDispatcher, isFieldAgent } = useRole();
  const { isSalesRep } = useSalesRep();
  const techOnly = isFieldAgent && !isAdmin && !isDispatcher;
  const twoRow = isSalesRep; // sales gets the availability strip on phones
  const ghost = "text-white/90 hover:bg-white/10 hover:text-white";
  return (
    <header data-testid="v7-header" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }} className="shrink-0 border-b z-20 v8-bar-hdr bg-[var(--v8-bar)] border-[var(--v8-bar-bd)] dark:bg-[#0b1a2e] dark:border-white/10">
      <div className="h-14 flex items-center gap-2 px-2 sm:px-4">
      <Button variant="ghost" size="icon" onClick={onMenu} className={`lg:hidden shrink-0 h-9 w-9 ${ghost}`} aria-label="Menu"><Menu className="h-5 w-5" /></Button>
      <CompanyLogo data-testid="header-logo" className="hidden min-[360px]:block h-6 w-auto max-w-[64px] object-contain object-left sm:h-8 lg:hidden" />
      <h1 className="hidden min-[400px]:block min-w-0 truncate text-base sm:text-lg font-bold text-white" title={typeof pageTitle === "string" ? pageTitle : undefined}>{pageTitle}</h1>


      <div className="ml-auto flex items-center gap-0.5 sm:gap-1.5 shrink-0">
        <Button variant="ghost" size="sm" onClick={() => openMandyVoice()} className={`hidden sm:inline-flex gap-1.5 ${ghost}`} title="Talk to the operations assistant">
          <Sparkle className="h-4 w-4" /><span className="text-xs">Ask Mandy</span>
        </Button>
        {isSalesRep && <div className="hidden md:block"><MyAvailabilitySwitch /></div>}
        <span className={twoRow ? "hidden md:contents" : "contents"}><StatusUndoButton /></span>
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
      </div>
      {twoRow && (
        /* Phones only: second slim strip so row 1 (menu, logo, bell, avatar) never clips. */
        <div data-testid="v7-mobile-strip" className="md:hidden flex h-11 items-center gap-1.5 border-t border-white/15 px-2">
          <MyAvailabilitySwitch labelled className="flex-1 max-w-[260px]" />
          <div className="ml-auto flex items-center gap-0.5">
            <StatusUndoButton />
          </div>
        </div>
      )}
    </header>
  );
}
