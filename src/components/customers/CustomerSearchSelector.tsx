import { useState, useRef, useEffect, useCallback } from "react";
import { Search, User, Building2, Phone, MapPin, Plus, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCustomerSearch, type CustomerSearchResult } from "@/hooks/useCustomerSearch";
import { cn } from "@/lib/utils";

interface CustomerSearchSelectorProps {
  value: string;
  onSelect: (customer: CustomerSearchResult) => void;
  onCreateNew?: () => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  selectedName?: string;
}

const CustomerSearchSelector = ({
  value,
  onSelect,
  onCreateNew,
  placeholder = "Search by name, phone, email, address...",
  className,
  disabled,
  selectedName,
}: CustomerSearchSelectorProps) => {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const { data: results = [], isLoading } = useCustomerSearch(debouncedQuery);

  // Debounce search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(query);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const displayName = useCallback((c: CustomerSearchResult) => {
    if (c.is_company && c.company_name) return c.company_name;
    return [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unnamed";
  }, []);

  const statusColor: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-700 border-emerald-200",
    lead: "bg-amber-100 text-amber-700 border-amber-200",
    inactive: "bg-muted text-muted-foreground",
  };

  return (
    <div ref={wrapperRef} className={cn("relative", className)}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          placeholder={placeholder}
          value={open ? query : (selectedName || query)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            if (selectedName) setQuery("");
          }}
          className="pl-9"
          disabled={disabled}
        />
        {isLoading && open && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>

      {/* Selected display */}
      {value && selectedName && !open && (
        <div className="mt-1 text-sm text-muted-foreground flex items-center gap-1">
          <User className="h-3 w-3" />
          <span>{selectedName}</span>
          <button
            type="button"
            onClick={() => {
              onSelect({ id: "", first_name: "", last_name: "", company_name: "", is_company: false, phone: "", email: "", primary_address_line1: "", city: "", status: "", relevance: 0 });
              setQuery("");
            }}
            className="ml-1 text-destructive hover:underline text-xs"
          >
            clear
          </button>
        </div>
      )}

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 top-full mt-1 w-full rounded-lg border bg-popover shadow-xl max-h-72 overflow-y-auto">
          {results.length === 0 && !isLoading && debouncedQuery.length > 0 && (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No customers found for "{debouncedQuery}"
            </div>
          )}

          {results.length > 0 && (
            <div className="py-1">
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Customers
              </div>
              {results.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 hover:bg-accent hover:text-accent-foreground transition-colors text-left group",
                    value === c.id && "bg-accent/50"
                  )}
                  onClick={() => {
                    onSelect(c);
                    setQuery(displayName(c));
                    setOpen(false);
                  }}
                >
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    {c.is_company ? (
                      <Building2 className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <User className="h-3.5 w-3.5 text-primary" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{displayName(c)}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {c.phone && (
                        <span className="flex items-center gap-0.5">
                          <Phone className="h-3 w-3" />
                          {c.phone}
                        </span>
                      )}
                      {c.primary_address_line1 && (
                        <span className="flex items-center gap-0.5 truncate">
                          <MapPin className="h-3 w-3" />
                          {c.primary_address_line1}
                        </span>
                      )}
                    </div>
                  </div>
                  {c.status && (
                    <Badge variant="outline" className={cn("text-[10px] shrink-0", statusColor[c.status] || "")}>
                      {c.status}
                    </Badge>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Create new option */}
          {onCreateNew && (
            <div className="border-t">
              <button
                type="button"
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-primary hover:bg-accent transition-colors"
                onClick={() => {
                  onCreateNew();
                  setOpen(false);
                }}
              >
                <Plus className="h-4 w-4" />
                Create new customer{query ? ` "${query}"` : ""}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CustomerSearchSelector;
