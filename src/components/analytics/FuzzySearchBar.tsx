import { useState, useMemo, useRef, useEffect } from "react";
import Fuse from "fuse.js";
import { Search, FileText, Receipt, Users, Briefcase } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface SearchItem {
  id: string;
  type: "quote" | "invoice" | "customer" | "lead";
  title: string;
  subtitle: string;
}

const typeConfig = {
  quote: { icon: FileText, color: "bg-blue-100 text-blue-700", label: "Quote" },
  invoice: { icon: Receipt, color: "bg-emerald-100 text-emerald-700", label: "Invoice" },
  customer: { icon: Users, color: "bg-purple-100 text-purple-700", label: "Customer" },
  lead: { icon: Briefcase, color: "bg-amber-100 text-amber-700", label: "Job" },
};

const FuzzySearchBar = () => {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const { data: items = [] } = useQuery<SearchItem[]>({
    queryKey: ["fuzzy-search-items"],
    queryFn: async () => {
      const [quotes, invoices, customers, leads] = await Promise.all([
        supabase.from("quotes").select("id, quote_number, status, total").limit(200),
        supabase.from("invoices").select("id, invoice_number, customer_name, grand_total, status").limit(200),
        supabase.from("customers").select("id, name, phone, email").limit(200),
        supabase.from("leads").select("id, customer_name, service_type, status").limit(200),
      ]);

      const result: SearchItem[] = [];
      quotes.data?.forEach((q) => result.push({ id: q.id, type: "quote", title: q.quote_number, subtitle: `R${Number(q.total).toLocaleString("en-ZA")} • ${q.status}` }));
      invoices.data?.forEach((i) => result.push({ id: i.id, type: "invoice", title: i.invoice_number, subtitle: `${i.customer_name} • R${Number(i.grand_total).toLocaleString("en-ZA")}` }));
      customers.data?.forEach((c) => result.push({ id: c.id, type: "customer", title: c.name, subtitle: c.phone || c.email || "" }));
      leads.data?.forEach((l) => result.push({ id: l.id, type: "lead", title: l.customer_name, subtitle: `${l.service_type} • ${l.status}` }));
      return result;
    },
    staleTime: 60000,
  });

  const fuse = useMemo(() => new Fuse(items, { keys: ["title", "subtitle"], threshold: 0.4 }), [items]);
  const results = query.length > 1 ? fuse.search(query).slice(0, 8) : [];

  return (
    <div ref={wrapperRef} className="relative w-full max-w-md">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search quotes, invoices, customers..."
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          className="pl-10 rounded-xl border-border/50 bg-card shadow-sm"
        />
      </div>
      {open && results.length > 0 && (
        <div className="absolute top-full mt-2 w-full bg-card rounded-xl border shadow-xl z-50 overflow-hidden">
          {results.map(({ item }) => {
            const cfg = typeConfig[item.type];
            const Icon = cfg.icon;
            return (
              <button
                key={`${item.type}-${item.id}`}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left"
                onClick={() => { setOpen(false); setQuery(""); }}
              >
                <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate text-foreground">{item.title}</p>
                  <p className="text-xs text-muted-foreground truncate">{item.subtitle}</p>
                </div>
                <Badge variant="secondary" className={`text-xs shrink-0 ${cfg.color}`}>{cfg.label}</Badge>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default FuzzySearchBar;
