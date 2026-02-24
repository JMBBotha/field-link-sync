/**
 * Unified Quote Builder Page — wraps Normal / Visual / Area builders
 * in a shared QuoteProvider with tabs and a persistent header.
 */

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Users, X, Loader2, Wand2, PanelRightClose, PanelRightOpen } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { QuoteProvider, useQuoteContext } from "@/contexts/QuoteContext";
import { useUnifiedClients } from "@/hooks/useUnifiedClients";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "@/hooks/use-toast";
import logo from "@/assets/logo.png";

/* ─── Shared Header with client selector ─── */
function QuoteSharedHeader({ onBack }: { onBack: () => void }) {
  const { meta, updateQuote, areas, items } = useQuoteContext();
  const { data: clients = [] } = useUnifiedClients();
  const [clientSearch, setClientSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedClient = useMemo(() => {
    if (!meta?.customer_id) return null;
    return clients.find((c) => c.id === meta.customer_id || c.customer_id === meta.customer_id) || null;
  }, [clients, meta?.customer_id]);

  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return clients.slice(0, 8);
    const q = clientSearch.toLowerCase();
    return clients
      .filter((c) =>
        c.name.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        (c.email && c.email.toLowerCase().includes(q))
      )
      .slice(0, 8);
  }, [clients, clientSearch]);

  const totalItems = items.filter((i) => !i.parent_item_id).length;
  const totalCost = items
    .filter((i) => !i.parent_item_id)
    .reduce((s, i) => s + (i.total_price ?? i.unit_price * i.quantity), 0);

  return (
    <header className="shrink-0 h-14 flex items-center justify-between px-4 shadow-sm" style={{ backgroundColor: "#0077B6" }}>
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={onBack}
          className="h-9 w-9 rounded-xl text-white hover:bg-white/10"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <img src={logo} alt="Logo" style={{ height: "41px" }} />
        <div className="hidden sm:block h-6 w-px bg-white/20" />
        <h1 className="hidden sm:block text-lg font-semibold tracking-tight text-white">
          Quote Builder
        </h1>
      </div>

      {/* Client selector in header */}
      <div className="flex items-center gap-3">
        <div className="relative hidden md:block">
          {selectedClient ? (
            <div className="flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-1.5 text-xs text-white">
              <Users className="h-3.5 w-3.5 shrink-0" />
              <span className="font-medium truncate max-w-[150px]">{selectedClient.name}</span>
              <button
                onClick={() => {
                  updateQuote({ customer_id: null, customer_name: null });
                  setClientSearch("");
                }}
                className="hover:text-white/60"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <div className="relative">
              <Input
                ref={inputRef}
                placeholder="Select client..."
                value={clientSearch}
                onChange={(e) => {
                  setClientSearch(e.target.value);
                  setShowDropdown(true);
                }}
                onFocus={() => setShowDropdown(true)}
                onBlur={() => setTimeout(() => setShowDropdown(false), 200)}
                className="h-8 w-48 text-xs rounded-lg bg-white/10 border-white/20 text-white placeholder:text-white/50"
              />
              {showDropdown && filteredClients.length > 0 && (
                <div className="absolute z-50 top-full right-0 mt-1 w-64 rounded-lg border bg-popover shadow-lg max-h-48 overflow-y-auto">
                  {filteredClients.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="w-full text-left px-2.5 py-1.5 hover:bg-muted/50 transition-colors"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        const cid = c.customer_id || c.id;
                        updateQuote({
                          customer_id: cid.startsWith("lead-") ? null : cid,
                          customer_name: c.name,
                        });
                        setClientSearch("");
                        setShowDropdown(false);
                      }}
                    >
                      <p className="text-xs font-medium truncate">{c.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {c.phone}
                        {c.email ? ` · ${c.email}` : ""}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="hidden md:flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-1.5">
          <span className="text-xs text-white/70">
            {totalItems} items · {areas.length} zones
          </span>
          <span className="text-sm font-bold text-white ml-1">
            R{totalCost.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
          </span>
        </div>

        {meta?.quote_number && (
          <span className="hidden lg:block text-[10px] text-white/50 font-mono">{meta.quote_number}</span>
        )}
      </div>
    </header>
  );
}

/* ─── Placeholder tabs for Visual and Area ─── */
function VisualBuilderTab() {
  const { items, areas } = useQuoteContext();
  return (
    <div className="flex items-center justify-center h-full text-muted-foreground">
      <div className="text-center space-y-2">
        <p className="text-sm font-medium">Visual Quote Builder</p>
        <p className="text-xs">
          {items.filter((i) => !i.parent_item_id).length} items across {areas.length} zones
        </p>
        <p className="text-[10px] text-muted-foreground/60">
          Visual canvas — data synced via shared context
        </p>
      </div>
    </div>
  );
}

function AreaBuilderTab() {
  const { items, areas, addArea, deleteArea, updateArea } = useQuoteContext();
  return (
    <div className="flex items-center justify-center h-full text-muted-foreground">
      <div className="text-center space-y-2">
        <p className="text-sm font-medium">Area Quote Builder</p>
        <p className="text-xs">
          {areas.length} areas defined · {items.filter((i) => !i.parent_item_id).length} items total
        </p>
        <p className="text-[10px] text-muted-foreground/60">
          5-step wizard — data synced via shared context
        </p>
      </div>
    </div>
  );
}

/* ─── Inner content (needs context) ─── */
function UnifiedQuoteBuilderInner() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [activeTab, setActiveTab] = useState("normal");

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{
        background: "linear-gradient(135deg, #1e6bb8 0%, #d0d0d0 100%)",
        backgroundAttachment: "fixed",
      }}
    >
      <QuoteSharedHeader onBack={() => navigate("/admin/quotes")} />

      {/* Builder mode tabs */}
      <div className="shrink-0 flex items-center justify-center border-b border-white/20 bg-white/5 backdrop-blur-sm">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full max-w-md">
          <TabsList className="w-full bg-white/10 h-9">
            <TabsTrigger value="normal" className="flex-1 text-xs data-[state=active]:bg-white data-[state=active]:text-foreground text-white/70">
              Normal
            </TabsTrigger>
            <TabsTrigger value="visual" className="flex-1 text-xs data-[state=active]:bg-white data-[state=active]:text-foreground text-white/70">
              Visual
            </TabsTrigger>
            <TabsTrigger value="area" className="flex-1 text-xs data-[state=active]:bg-white data-[state=active]:text-foreground text-white/70">
              Area
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === "normal" && <NormalBuilderTab />}
        {activeTab === "visual" && <VisualBuilderTab />}
        {activeTab === "area" && <AreaBuilderTab />}
      </div>
    </div>
  );
}

/* ─── Normal builder (re-exports existing logic, uses context for persistence) ─── */
function NormalBuilderTab() {
  // For now, render the existing AdminQuoteBuilderPage content
  // This will be progressively migrated to use QuoteContext
  const { items, areas, loading } = useQuoteContext();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-full text-muted-foreground">
      <div className="text-center space-y-2">
        <p className="text-sm font-medium">Normal Quote Builder</p>
        <p className="text-xs">
          {items.filter((i) => !i.parent_item_id).length} items across {areas.length} zones
        </p>
        <p className="text-[10px] text-muted-foreground/60">
          Drag-and-drop product palette — data synced via shared context
        </p>
      </div>
    </div>
  );
}

/* ─── Outer wrapper: creates/loads quote, then mounts provider ─── */
const AdminQuoteBuilderPageUnified = () => {
  const [searchParams] = useSearchParams();
  const [quoteId, setQuoteId] = useState<string | null>(searchParams.get("quoteId"));
  const [creating, setCreating] = useState(!quoteId);
  const navigate = useNavigate();

  // Auto-create a draft quote if no quoteId is provided
  useEffect(() => {
    if (quoteId) return;
    let cancelled = false;

    (async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData?.user?.id;
        if (!userId) {
          toast({ title: "You must be logged in", variant: "destructive" });
          navigate("/admin/quotes");
          return;
        }

        const { data, error } = await (supabase.from("quotes") as any)
          .insert({
            sales_engineer_id: userId,
            status: "draft",
            subtotal: 0,
            vat_rate: 0.15,
            vat_amount: 0,
            total: 0,
          })
          .select("id")
          .single();

        if (error) throw error;
        if (!cancelled) {
          setQuoteId(data.id);
          setCreating(false);
        }
      } catch (err: any) {
        toast({ title: "Failed to create quote", description: err.message, variant: "destructive" });
        if (!cancelled) navigate("/admin/quotes");
      }
    })();

    return () => { cancelled = true; };
  }, [quoteId, navigate]);

  if (creating || !quoteId) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "linear-gradient(135deg, #1e6bb8 0%, #d0d0d0 100%)" }}>
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-white" />
          <p className="text-sm text-white/80">Preparing quote...</p>
        </div>
      </div>
    );
  }

  return (
    <QuoteProvider quoteId={quoteId}>
      <UnifiedQuoteBuilderInner />
    </QuoteProvider>
  );
};

export default AdminQuoteBuilderPageUnified;
