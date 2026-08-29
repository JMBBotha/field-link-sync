import { useState, useEffect, useMemo, useCallback } from "react";
import Fuse from "fuse.js";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Search, FileText, Receipt, Users, Briefcase, Command, Truck, ClipboardList, Wrench } from "lucide-react";

interface SearchItem {
  id: string;
  type: "quote" | "invoice" | "customer" | "lead" | "supplier" | "proposal" | "maintenance";
  title: string;
  subtitle: string;
  path: string;
}

const typeConfig = {
  quote: { icon: FileText, color: "bg-blue-500/20 text-blue-400 border-blue-500/30", label: "Quote" },
  invoice: { icon: Receipt, color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", label: "Invoice" },
  customer: { icon: Users, color: "bg-purple-500/20 text-purple-400 border-purple-500/30", label: "Customer" },
  lead: { icon: Briefcase, color: "bg-amber-500/20 text-amber-400 border-amber-500/30", label: "Job" },
  supplier: { icon: Truck, color: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30", label: "Supplier" },
  proposal: { icon: ClipboardList, color: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30", label: "Proposal" },
  maintenance: { icon: Wrench, color: "bg-rose-500/20 text-rose-400 border-rose-500/30", label: "Maintenance" },
};

interface GlobalSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const GlobalSearchDialog = ({ open, onOpenChange }: GlobalSearchDialogProps) => {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const { data: items = [] } = useQuery<SearchItem[]>({
    queryKey: ["global-search-items"],
    queryFn: async () => {
      const [quotes, invoices, customers, leads, suppliers, proposals, maintenance] = await Promise.all([
        supabase.from("quotes").select("id, quote_number, status, total").neq("status", "superseded").limit(300),
        supabase.from("invoices").select("id, invoice_number, customer_name, grand_total, status").limit(300),
        supabase.from("customers").select("id, name, phone, email").limit(300),
        supabase.from("leads").select("id, customer_name, service_type, status").limit(300),
        supabase.from("suppliers").select("id, name, contact_name, main_phone, contact_phone, supplier_type").limit(300),
        supabase.from("proposals").select("id, proposal_number, reference, status, total").limit(300),
        supabase.from("maintenance_schedules").select("id, due_date, status, notes, customers(name)").limit(300),
      ]);

      const result: SearchItem[] = [];
      quotes.data?.forEach((q) =>
        result.push({ id: q.id, type: "quote", title: q.quote_number, subtitle: `R${Number(q.total).toLocaleString("en-ZA")} • ${q.status}`, path: "/admin/quotes" })
      );
      invoices.data?.forEach((i) =>
        result.push({ id: i.id, type: "invoice", title: i.invoice_number, subtitle: `${i.customer_name} • R${Number(i.grand_total).toLocaleString("en-ZA")}`, path: "/admin/invoices" })
      );
      customers.data?.forEach((c) =>
        result.push({ id: c.id, type: "customer", title: c.name, subtitle: c.phone || c.email || "", path: `/admin/customers/${c.id}` })
      );
      leads.data?.forEach((l) =>
        result.push({ id: l.id, type: "lead", title: l.customer_name, subtitle: `${l.service_type} • ${l.status}`, path: "/admin/dispatch" })
      );
      suppliers.data?.forEach((s: any) =>
        result.push({
          id: s.id,
          type: "supplier",
          title: s.name,
          subtitle: [s.contact_name, s.main_phone || s.contact_phone, s.supplier_type].filter(Boolean).join(" • "),
          path: "/admin/suppliers",
        })
      );
      proposals.data?.forEach((p: any) =>
        result.push({
          id: p.id,
          type: "proposal",
          title: p.proposal_number || p.reference || "Proposal",
          subtitle: [p.reference, p.status, p.total != null ? `R${Number(p.total).toLocaleString("en-ZA")}` : null].filter(Boolean).join(" • "),
          path: "/admin/templates",
        })
      );
      maintenance.data?.forEach((m: any) =>
        result.push({
          id: m.id,
          type: "maintenance",
          title: m.customers?.name || "Maintenance visit",
          subtitle: [m.due_date ? `Due ${m.due_date}` : null, m.status, m.notes].filter(Boolean).join(" • "),
          path: "/admin/maintenance",
        })
      );
      return result;
    },
    staleTime: 60000,
    enabled: open,
  });

  const fuse = useMemo(() => new Fuse(items, { keys: ["title", "subtitle"], threshold: 0.4 }), [items]);
  const results = query.length > 1 ? fuse.search(query).slice(0, 10) : [];

  const handleSelect = useCallback((item: SearchItem) => {
    onOpenChange(false);
    navigate(item.path);
  }, [navigate, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        <div className="flex items-center border-b px-4 py-3">
          <Search className="h-4 w-4 text-muted-foreground mr-3 shrink-0" />
          <Input
            autoFocus
            placeholder="Search jobs, customers, invoices, quotes..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="border-0 shadow-none focus-visible:ring-0 px-0 text-base"
          />
          <kbd className="hidden sm:inline-flex items-center gap-1 rounded border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground ml-2 shrink-0">
            ESC
          </kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {query.length > 1 && results.length === 0 && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No results for "{query}"
            </div>
          )}
          {results.map(({ item }) => {
            const cfg = typeConfig[item.type];
            const Icon = cfg.icon;
            return (
              <button
                key={`${item.type}-${item.id}`}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left"
                onClick={() => handleSelect(item)}
              >
                <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate text-foreground">{item.title}</p>
                  <p className="text-xs text-muted-foreground truncate">{item.subtitle}</p>
                </div>
                <Badge variant="outline" className={`text-[10px] shrink-0 ${cfg.color}`}>
                  {cfg.label}
                </Badge>
              </button>
            );
          })}
          {query.length <= 1 && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <Command className="h-5 w-5 mx-auto mb-2 opacity-40" />
              Start typing to search across all records
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default GlobalSearchDialog;
