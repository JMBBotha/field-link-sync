import { useState, useEffect, useMemo, useCallback } from "react";
import Fuse from "fuse.js";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Search, FileText, Receipt, Users, Briefcase, Command, Truck, ClipboardList, Wrench, Home, MapPin } from "lucide-react";

interface SearchItem {
  id: string;
  type: "quote" | "invoice" | "customer" | "lead" | "supplier" | "proposal" | "maintenance" | "room" | "location";
  title: string;
  subtitle: string;
  searchText: string;
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
  room: { icon: Home, color: "bg-teal-500/20 text-teal-400 border-teal-500/30", label: "Room" },
  location: { icon: MapPin, color: "bg-orange-500/20 text-orange-400 border-orange-500/30", label: "Location" },
};

interface GlobalSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const ROW_LIMIT = 500;
const join = (...parts: (string | null | undefined | number)[]) =>
  parts.filter((p) => p !== null && p !== undefined && `${p}`.trim() !== "").join(" • ");

const GlobalSearchDialog = ({ open, onOpenChange }: GlobalSearchDialogProps) => {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const { data: items = [] } = useQuery<SearchItem[]>({
    queryKey: ["global-search-items"],
    queryFn: async () => {
      const [quotes, invoices, customers, leads, suppliers, proposals, maintenance, units, locations] =
        await Promise.all([
          supabase
            .from("quotes")
            .select("id, quote_number, customer_name, reference_text, status, total")
            .neq("status", "superseded")
            .order("created_at", { ascending: false })
            .limit(ROW_LIMIT),
          supabase
            .from("invoices")
            .select("id, invoice_number, customer_name, customer_address, grand_total, status")
            .order("created_at", { ascending: false })
            .limit(ROW_LIMIT),
          supabase
            .from("customers")
            .select("id, name, phone, email, address, primary_address_line1, city, company_name, search_aliases")
            .order("created_at", { ascending: false })
            .limit(ROW_LIMIT),
          supabase
            .from("leads")
            .select("id, customer_name, customer_phone, customer_address, company_name, email, service_type, status")
            .order("created_at", { ascending: false })
            .limit(ROW_LIMIT),
          supabase
            .from("suppliers")
            .select("id, name, contact_name, main_phone, contact_phone, supplier_type")
            .order("created_at", { ascending: false })
            .limit(ROW_LIMIT),
          supabase
            .from("proposals")
            .select("id, proposal_number, reference, status, total")
            .order("created_at", { ascending: false })
            .limit(ROW_LIMIT),
          supabase
            .from("maintenance_schedules")
            .select("id, due_date, status, notes, customers(name)")
            .order("created_at", { ascending: false })
            .limit(ROW_LIMIT),
          supabase
            .from("customer_units")
            .select("id, customer_id, label, full_address, notes")
            .order("created_at", { ascending: false })
            .limit(ROW_LIMIT),
          supabase
            .from("customer_locations")
            .select("id, customer_id, label, address")
            .order("created_at", { ascending: false })
            .limit(ROW_LIMIT),
        ]);

      // Surface failures instead of silently returning an empty source.
      Object.entries({ quotes, invoices, customers, leads, suppliers, proposals, maintenance, units, locations }).forEach(
        ([name, res]: [string, any]) => {
          if (res?.error) console.error(`[GlobalSearch] ${name} query failed:`, res.error.message);
        }
      );

      const result: SearchItem[] = [];
      quotes.data?.forEach((q: any) =>
        result.push({
          id: q.id,
          type: "quote",
          title: join(q.quote_number, q.customer_name) || "Quote",
          subtitle: join(q.reference_text, `R${Number(q.total || 0).toLocaleString("en-ZA")}`, q.status),
          searchText: join(q.quote_number, q.customer_name, q.reference_text, q.status),
          path: "/admin/quotes",
        })
      );
      invoices.data?.forEach((i: any) =>
        result.push({
          id: i.id,
          type: "invoice",
          title: join(i.invoice_number, i.customer_name) || "Invoice",
          subtitle: join(i.customer_address, `R${Number(i.grand_total || 0).toLocaleString("en-ZA")}`, i.status),
          searchText: join(i.invoice_number, i.customer_name, i.customer_address, i.status),
          path: "/admin/invoices",
        })
      );
      customers.data?.forEach((c: any) =>
        result.push({
          id: c.id,
          type: "customer",
          title: c.name,
          subtitle: join(c.phone, c.email, c.address || c.primary_address_line1, c.city),
          searchText: join(
            c.name,
            c.company_name,
            c.phone,
            c.email,
            c.address,
            c.primary_address_line1,
            c.city,
            Array.isArray(c.search_aliases) ? c.search_aliases.join(" ") : c.search_aliases
          ),
          path: `/admin/customers/${c.id}`,
        })
      );
      leads.data?.forEach((l: any) =>
        result.push({
          id: l.id,
          type: "lead",
          title: l.customer_name || l.company_name || "Job",
          subtitle: join(l.customer_address, l.customer_phone, l.service_type, l.status),
          searchText: join(
            l.customer_name,
            l.company_name,
            l.customer_phone,
            l.email,
            l.customer_address,
            l.service_type,
            l.status
          ),
          path: "/admin/dispatch",
        })
      );
      suppliers.data?.forEach((s: any) =>
        result.push({
          id: s.id,
          type: "supplier",
          title: s.name,
          subtitle: join(s.contact_name, s.main_phone || s.contact_phone, s.supplier_type),
          searchText: join(s.name, s.contact_name, s.main_phone, s.contact_phone, s.supplier_type),
          path: "/admin/suppliers",
        })
      );
      proposals.data?.forEach((p: any) =>
        result.push({
          id: p.id,
          type: "proposal",
          title: p.proposal_number || p.reference || "Proposal",
          subtitle: join(p.reference, p.status, p.total != null ? `R${Number(p.total).toLocaleString("en-ZA")}` : null),
          searchText: join(p.proposal_number, p.reference, p.status),
          path: "/admin/templates",
        })
      );
      maintenance.data?.forEach((m: any) =>
        result.push({
          id: m.id,
          type: "maintenance",
          title: m.customers?.name || "Maintenance visit",
          subtitle: join(m.due_date ? `Due ${m.due_date}` : null, m.status, m.notes),
          searchText: join(m.customers?.name, m.due_date, m.status, m.notes),
          path: "/admin/maintenance",
        })
      );
      units.data?.forEach((u: any) =>
        result.push({
          id: u.id,
          type: "room",
          title: u.label || "Room",
          subtitle: join(u.full_address, u.notes),
          searchText: join(u.label, u.full_address, u.notes),
          path: u.customer_id ? `/admin/customers/${u.customer_id}` : "/admin/customers",
        })
      );
      locations.data?.forEach((loc: any) =>
        result.push({
          id: loc.id,
          type: "location",
          title: loc.label || loc.address || "Location",
          subtitle: loc.address || "",
          searchText: join(loc.label, loc.address),
          path: loc.customer_id ? `/admin/customers/${loc.customer_id}` : "/admin/customers",
        })
      );
      return result;
    },
    staleTime: 60000,
    enabled: open,
  });

  const fuse = useMemo(
    () =>
      new Fuse(items, {
        keys: [
          { name: "searchText", weight: 2 },
          { name: "title", weight: 2 },
          { name: "subtitle", weight: 1 },
        ],
        threshold: 0.35,
        ignoreLocation: true,
        minMatchCharLength: 2,
      }),
    [items]
  );

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
            placeholder="Search jobs, customers, quotes, suppliers, proposals, maintenance..."
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
