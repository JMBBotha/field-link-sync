import { useState, useRef, useEffect, useMemo } from "react";
import { Search, User, Phone, Mail, Briefcase, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useUnifiedClients, type UnifiedClient } from "@/hooks/useUnifiedClients";
import { cn } from "@/lib/utils";

interface CustomerSearchDropdownProps {
  value: string;
  onSelect: (client: UnifiedClient) => void;
  placeholder?: string;
  className?: string;
}

const CustomerSearchDropdown = ({
  value,
  onSelect,
  placeholder = "Search customers...",
  className,
}: CustomerSearchDropdownProps) => {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { data: clients = [], isLoading } = useUnifiedClients();

  // Find selected client name for display
  const selectedClient = clients.find(
    (c) => c.customer_id === value || c.id === value
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return clients.slice(0, 50);
    const q = query.toLowerCase();
    return clients
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.phone.toLowerCase().includes(q) ||
          (c.email && c.email.toLowerCase().includes(q)) ||
          (c.address && c.address.toLowerCase().includes(q))
      )
      .slice(0, 30);
  }, [clients, query]);

  return (
    <div ref={wrapperRef} className={cn("relative", className)}>
      <div
        className="flex items-center border border-input bg-background rounded-md cursor-pointer hover:bg-accent/30 transition-colors"
        onClick={() => {
          setOpen(true);
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
      >
        {open ? (
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              className="border-0 pl-9 h-10 focus-visible:ring-0 focus-visible:ring-offset-0"
              onFocus={() => setOpen(true)}
            />
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 h-10 flex-1 min-w-0">
            <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span
              className={cn(
                "text-sm truncate",
                selectedClient ? "text-foreground" : "text-muted-foreground"
              )}
            >
              {selectedClient?.name || placeholder}
            </span>
          </div>
        )}
        <ChevronDown className="h-4 w-4 text-muted-foreground mr-2 shrink-0" />
      </div>

      {open && (
        <div className="absolute top-full mt-1 w-full bg-popover border rounded-lg shadow-xl z-50 max-h-64 overflow-y-auto">
          {isLoading && filtered.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">No clients found</div>
          ) : (
            filtered.map((client) => (
              <button
                key={client.id}
                type="button"
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 hover:bg-primary hover:text-primary-foreground transition-colors text-left group",
                  (client.customer_id === value || client.id === value) && "bg-primary/10"
                )}
                onClick={() => {
                  onSelect(client);
                  setQuery("");
                  setOpen(false);
                }}
              >
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <User className="h-3.5 w-3.5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate group-hover:text-primary-foreground">{client.name}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground group-hover:text-primary-foreground/80">
                    <span className="flex items-center gap-0.5 truncate">
                      <Phone className="h-3 w-3 shrink-0" />
                      {client.phone}
                    </span>
                    {client.email && (
                      <span className="flex items-center gap-0.5 truncate">
                        <Mail className="h-3 w-3 shrink-0" />
                        {client.email}
                      </span>
                    )}
                  </div>
                </div>
                <div className="shrink-0">
                {client.source === "lead" ? (
                    <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 group-hover:bg-primary-foreground/20 group-hover:text-primary-foreground group-hover:border-primary-foreground/30">
                      <Briefcase className="h-2.5 w-2.5 mr-0.5" />
                      Lead
                    </Badge>
                  ) : client.lead_status ? (
                    <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-700 border-blue-200 group-hover:bg-primary-foreground/20 group-hover:text-primary-foreground group-hover:border-primary-foreground/30">
                      {client.lead_status.replace("_", " ")}
                    </Badge>
                  ) : null}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default CustomerSearchDropdown;
