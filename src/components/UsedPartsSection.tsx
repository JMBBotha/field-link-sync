import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Search, Package, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { offlineDb } from "@/lib/offlineDb";

interface SupplierProduct {
  id: string;
  product_code: string;
  description: string;
  cost_price: number;
  discounted_cost: number | null;
  category: string;
  supplier_id: string;
}

interface UsedPart {
  id: string;
  product_id: string;
  product_code: string;
  product_name: string;
  unit_cost: number;
  quantity: number;
  line_total: number;
}

interface UsedPartsSectionProps {
  leadId: string;
  agentId: string;
  isOnline: boolean;
  queueOperation?: (
    operationType: any,
    tableName: string,
    recordId: string,
    data: any
  ) => Promise<string | void>;
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(amount);

const UsedPartsSection = ({ leadId, agentId, isOnline, queueOperation }: UsedPartsSectionProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<SupplierProduct | null>(null);
  const [quantity, setQuantity] = useState(1);

  // Fetch used parts for this lead
  const { data: usedParts = [], isLoading: partsLoading } = useQuery({
    queryKey: ["job-used-parts", leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_used_parts" as any)
        .select("id, product_id, product_code, product_name, unit_cost, quantity, line_total")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as UsedPart[];
    },
    enabled: !!leadId,
  });

  // Search supplier products
  const { data: searchResults = [], isFetching: searching } = useQuery({
    queryKey: ["supplier-product-search", searchQuery],
    queryFn: async () => {
      if (!searchQuery || searchQuery.length < 2) return [];

      // Try online first, fall back to offline cache
      if (isOnline) {
        const { data, error } = await supabase
          .from("supplier_products")
          .select("id, product_code, description, cost_price, category, supplier_id")
          .or(`product_code.ilike.%${searchQuery}%,description.ilike.%${searchQuery}%`)
          .eq("is_active", true)
          .limit(15);
        if (error) {
          console.warn("[Parts] Online search failed, trying offline cache:", error.message);
        } else {
          return data as SupplierProduct[];
        }
      }

      // Offline fallback
      const cached = await offlineDb.getCachedCatalogProducts(searchQuery);
      return cached.slice(0, 15).map(p => ({
        id: p.id,
        product_code: p.product_code,
        description: p.description,
        cost_price: p.cost_price,
        category: p.category,
        supplier_id: p.supplier_id,
      }));
    },
    enabled: searchQuery.length >= 2,
    staleTime: 10_000,
  });

  // Add part mutation
  const addPartMutation = useMutation({
    mutationFn: async (product: SupplierProduct) => {
      const partData = {
        lead_id: leadId,
        product_id: product.id,
        product_code: product.product_code,
        product_name: product.description,
        unit_cost: product.cost_price,
        quantity,
        added_by: agentId,
      };

      if (isOnline) {
        const { error } = await supabase
          .from("job_used_parts" as any)
          .insert(partData as any);
        if (error) throw error;
        console.log("[Parts] Added part online:", product.product_code);
      } else if (queueOperation) {
        const tempId = crypto.randomUUID();
        await queueOperation("create_invoice" as any, "job_used_parts", tempId, partData);
        console.log("[Parts] Queued part offline:", product.product_code);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job-used-parts", leadId] });
      setSelectedProduct(null);
      setQuantity(1);
      setSearchQuery("");
      toast({ title: "Part added", description: "Material added to job" });
    },
    onError: (error: any) => {
      console.error("[Parts] Add error:", error);
      toast({ title: "Error", description: error.message || "Failed to add part", variant: "destructive" });
    },
  });

  // Delete part mutation
  const deletePartMutation = useMutation({
    mutationFn: async (partId: string) => {
      if (isOnline) {
        const { error } = await supabase
          .from("job_used_parts" as any)
          .delete()
          .eq("id", partId);
        if (error) throw error;
        console.log("[Parts] Deleted part online:", partId.slice(0, 8));
      } else if (queueOperation) {
        await queueOperation("delete_photo" as any, "job_used_parts", partId, {});
        console.log("[Parts] Queued part deletion offline:", partId.slice(0, 8));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["job-used-parts", leadId] });
    },
    onError: (error: any) => {
      console.error("[Parts] Delete error:", error);
      toast({ title: "Error", description: "Failed to remove part", variant: "destructive" });
    },
  });

  const handleAddPart = () => {
    if (!selectedProduct) return;
    addPartMutation.mutate(selectedProduct);
  };

  const partsTotal = usedParts.reduce((sum, p) => sum + (p.line_total || p.unit_cost * p.quantity), 0);

  return (
    <div className="p-2.5 rounded-xl bg-background/50 space-y-2">
      <div className="flex items-center gap-1.5">
        <Package className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold">Used Parts / Materials</span>
        {usedParts.length > 0 && (
          <span className="ml-auto text-xs font-medium text-primary">
            {formatCurrency(partsTotal)}
          </span>
        )}
      </div>

      {/* Product Search */}
      <Popover open={searchOpen} onOpenChange={setSearchOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start h-9 text-xs rounded-lg"
            role="combobox"
          >
            <Search className="h-3.5 w-3.5 mr-2 shrink-0 text-muted-foreground" />
            {selectedProduct
              ? `${selectedProduct.product_code} - ${selectedProduct.description.slice(0, 30)}`
              : "Search parts by SKU or name..."}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[calc(100vw-4rem)] max-w-sm p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Type SKU or product name..."
              value={searchQuery}
              onValueChange={setSearchQuery}
            />
            <CommandList>
              <CommandEmpty>
                {searching ? "Searching..." : searchQuery.length < 2 ? "Type 2+ characters..." : "No products found"}
              </CommandEmpty>
              <CommandGroup>
                {searchResults.map((product) => (
                  <CommandItem
                    key={product.id}
                    value={product.id}
                    onSelect={() => {
                      setSelectedProduct(product);
                      setSearchOpen(false);
                      setSearchQuery("");
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{product.product_code}</p>
                      <p className="text-xs text-muted-foreground truncate">{product.description}</p>
                    </div>
                    <span className="text-xs font-medium shrink-0 ml-2">
                      {formatCurrency(product.cost_price)}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Selected product details + quantity */}
      {selectedProduct && (
        <div className="flex items-end gap-2 p-2 rounded-lg bg-accent/30">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">{selectedProduct.description}</p>
            <p className="text-[10px] text-muted-foreground">
              {selectedProduct.product_code} · {formatCurrency(selectedProduct.cost_price)}
            </p>
          </div>
          <div className="w-16 shrink-0">
            <Label className="text-[10px] text-muted-foreground">Qty</Label>
            <Input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
              className="h-8 text-sm rounded-lg text-center"
            />
          </div>
          <Button
            size="sm"
            className="h-8 px-3 shrink-0 rounded-lg"
            onClick={handleAddPart}
            disabled={addPartMutation.isPending}
          >
            {addPartMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      )}

      {/* Parts list */}
      {partsLoading ? (
        <div className="flex justify-center py-3">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : usedParts.length > 0 ? (
        <div className="space-y-1">
          {usedParts.map((part) => (
            <div
              key={part.id}
              className="flex items-center gap-2 p-2 rounded-lg bg-accent/20 text-xs"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{part.product_name}</p>
                <p className="text-[10px] text-muted-foreground">
                  {part.product_code} · {part.quantity} × {formatCurrency(part.unit_cost)}
                </p>
              </div>
              <span className="font-medium shrink-0">
                {formatCurrency(part.line_total || part.unit_cost * part.quantity)}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-destructive hover:text-destructive shrink-0"
                onClick={() => deletePartMutation.mutate(part.id)}
                disabled={deletePartMutation.isPending}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}

          {/* Running total */}
          <div className="flex justify-between items-center pt-1 border-t border-border/50 text-xs">
            <span className="text-muted-foreground font-medium">Parts Total</span>
            <span className="font-bold text-primary">{formatCurrency(partsTotal)}</span>
          </div>
        </div>
      ) : (
        <p className="text-[10px] text-muted-foreground text-center py-1">No parts added yet</p>
      )}
    </div>
  );
};

export default UsedPartsSection;
