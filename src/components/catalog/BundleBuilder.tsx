import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, Search, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const BUNDLE_TYPES = [
  { value: "piping_kit", label: "Piping Kit", desc: "Copper + Lagging" },
  { value: "electrical_kit", label: "Electrical Kit", desc: "Cable + Drain" },
  { value: "full_install_kit", label: "Full Install Kit", desc: "All materials" },
];

type BundleItemLocal = {
  id?: string;
  supplier_product_id: string;
  quantity: number;
  length_metres: number | null;
  is_length_item: boolean;
  is_optional: boolean;
  notes: string;
  sort_order: number;
  description: string;
  product_code: string;
  cost_price: number;
  price_per_metre: number | null;
  sold_in_length: boolean;
  supplier_name?: string;
  pipe_size?: string;
  short_name?: string;
};

type Props = {
  bundleId: string | null;
  onClose: () => void;
};

const BundleBuilder = ({ bundleId, onClose }: Props) => {
  const isEditing = !!bundleId;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [bundleType, setBundleType] = useState("full_install_kit");
  const [items, setItems] = useState<BundleItemLocal[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);

  // Load existing bundle
  const { data: existingBundle } = useQuery({
    queryKey: ["bundle-detail", bundleId],
    enabled: isEditing,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("installation_bundles")
        .select("*")
        .eq("id", bundleId!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: existingItems } = useQuery({
    queryKey: ["bundle-items-edit", bundleId],
    enabled: isEditing,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bundle_items")
        .select("*, supplier_products(description, product_code, cost_price, price_per_metre, sold_in_length, pipe_size, short_name, suppliers(name))")
        .eq("bundle_id", bundleId!)
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (existingBundle) {
      setName(existingBundle.name);
      setDescription(existingBundle.description || "");
      setBundleType((existingBundle as any).bundle_type || "full_install_kit");
    }
  }, [existingBundle]);

  useEffect(() => {
    if (existingItems) {
      setItems(existingItems.map((item: any) => ({
        id: item.id,
        supplier_product_id: item.supplier_product_id,
        quantity: item.quantity,
        length_metres: item.length_metres,
        is_length_item: item.is_length_item,
        is_optional: item.is_optional ?? false,
        notes: item.notes || "",
        sort_order: item.sort_order,
        description: item.supplier_products?.description || "",
        product_code: item.supplier_products?.product_code || "",
        cost_price: item.supplier_products?.cost_price || 0,
        price_per_metre: item.supplier_products?.price_per_metre,
        sold_in_length: item.supplier_products?.sold_in_length || false,
        supplier_name: item.supplier_products?.suppliers?.name,
        pipe_size: item.supplier_products?.pipe_size,
        short_name: item.supplier_products?.short_name,
      })));
    }
  }, [existingItems]);

  // Product search — multi-term search across all fields (same logic as ProductPalette)
  const { data: searchResults = [] } = useQuery({
    queryKey: ["bundle-product-search", search],
    enabled: search.length >= 2,
    queryFn: async () => {
      // Split into individual terms for multi-term matching
      const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
      if (terms.length === 0) return [];

      // Use the first term for the Supabase query to get a broad result set
      const firstTerm = terms[0].replace(/[%_]/g, "\\$&");
      const { data, error } = await supabase
        .from("supplier_products")
        .select("id, description, product_code, cost_price, price_per_metre, sold_in_length, pipe_size, short_name, brand, category, suppliers(name)")
        .or("archived.is.null,archived.eq.false")
        .or(`description.ilike.%${firstTerm}%,product_code.ilike.%${firstTerm}%,short_name.ilike.%${firstTerm}%,brand.ilike.%${firstTerm}%,category.ilike.%${firstTerm}%`)
        .limit(200);
      if (error) {
        console.error("[BundleSearch] query error:", error);
        throw error;
      }

      // Client-side: require ALL terms match in the combined blob
      const filtered = (data || []).filter(p => {
        const blob = [p.product_code, p.short_name, p.description, p.brand, p.category, p.suppliers?.name]
          .filter(Boolean).join(" ").toLowerCase();
        return terms.every(t => blob.includes(t));
      });

      console.log(`[BundleSearch] "${search}" → DB: ${data?.length}, after multi-term filter: ${filtered.length}`);
      return filtered as any[];
    },
  });

  const addItem = (product: any) => {
    if (items.some(i => i.supplier_product_id === product.id)) {
      toast.info("Item already in bundle");
      return;
    }
    setItems(prev => [...prev, {
      supplier_product_id: product.id,
      quantity: product.sold_in_length ? 1 : 1,
      length_metres: product.sold_in_length ? 4 : null,
      is_length_item: product.sold_in_length || false,
      is_optional: false,
      notes: "",
      sort_order: prev.length,
      description: product.description,
      product_code: product.product_code,
      cost_price: product.cost_price,
      price_per_metre: product.price_per_metre,
      sold_in_length: product.sold_in_length || false,
      supplier_name: product.suppliers?.name,
      pipe_size: product.pipe_size,
      short_name: product.short_name,
    }]);
    setPickerOpen(false);
    setSearch("");
  };

  const removeItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: string, value: any) => {
    setItems(prev => prev.map((item, i) => i === index ? { ...item, [field]: value } : item));
  };

  const getLineTotal = (item: BundleItemLocal) => {
    if (item.is_length_item && item.length_metres) {
      return item.length_metres * (item.price_per_metre || 0);
    }
    return item.quantity * item.cost_price;
  };

  const bundleTotal = items.reduce((sum, item) => sum + getLineTotal(item), 0);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Bundle name is required");
      return;
    }
    setSaving(true);
    try {
      let bid: string;
      const bundleData: any = {
        name: name.trim(),
        description: description.trim() || null,
        bundle_type: bundleType,
        ac_type: null,
        btu_rating: null,
        pipe_size: null,
      };

      if (isEditing) {
        const { error } = await supabase.from("installation_bundles").update(bundleData).eq("id", bundleId!);
        if (error) throw error;
        bid = bundleId!;
        await supabase.from("bundle_items").delete().eq("bundle_id", bid);
      } else {
        const { data, error } = await supabase.from("installation_bundles").insert(bundleData).select().single();
        if (error) throw error;
        bid = data.id;
      }

      if (items.length > 0) {
        const itemRows = items.map((item, i) => ({
          bundle_id: bid,
          supplier_product_id: item.supplier_product_id,
          quantity: item.quantity,
          length_metres: item.length_metres,
          is_length_item: item.is_length_item,
          is_optional: item.is_optional,
          notes: item.notes || null,
          sort_order: i,
        }));
        const { error: iErr } = await supabase.from("bundle_items").insert(itemRows);
        if (iErr) throw iErr;
      }

      toast.success(isEditing ? "Bundle updated" : "Bundle created");
      onClose();
    } catch (e: any) {
      toast.error(e.message || "Failed to save bundle");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h3 className="font-semibold">{isEditing ? "Edit Bundle" : "Create Bundle"}</h3>
      </div>

      {/* Bundle metadata */}
      <Card className="p-4 space-y-3">
        <div>
          <Label className="text-xs">Bundle Name *</Label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. 12K Midwall Piping Kit" />
        </div>
        <div>
          <Label className="text-xs">Description</Label>
          <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional description" />
        </div>
        <div>
          <Label className="text-xs">Bundle Type</Label>
          <Select value={bundleType} onValueChange={setBundleType}>
            <SelectTrigger><SelectValue placeholder="Select type..." /></SelectTrigger>
            <SelectContent>
              {BUNDLE_TYPES.map(t => (
                <SelectItem key={t.value} value={t.value}>
                  <span>{t.label}</span>
                  <span className="text-muted-foreground ml-1.5 text-xs">— {t.desc}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Items */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <Label className="text-sm font-medium">Bundle Items ({items.length})</Label>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setPickerOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add Item
          </Button>
        </div>

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No items yet. Click "Add Item" to search and add products.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b">
                  <th className="text-left font-medium py-1.5 w-20">Code</th>
                  <th className="text-left font-medium py-1.5">Description</th>
                  <th className="text-right font-medium py-1.5 w-24">Length / Qty</th>
                  <th className="text-right font-medium py-1.5 w-20">Cost/m</th>
                  <th className="text-right font-medium py-1.5 w-20">Line Total</th>
                  <th className="text-center font-medium py-1.5 w-16">Optional</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const unitCost = item.is_length_item ? (item.price_per_metre || 0) : item.cost_price;
                  const lineTotal = getLineTotal(item);
                  return (
                    <tr key={idx} className="border-b border-dashed">
                      <td className="py-1.5">
                        <span className="font-mono text-[10px] text-muted-foreground">{item.product_code}</span>
                      </td>
                      <td className="py-1.5">
                        <div className="font-medium truncate max-w-[220px] text-xs">{item.description?.slice(0, 50)}</div>
                        {item.pipe_size && (
                          <span className="text-[10px] text-muted-foreground">⌀ {item.pipe_size}</span>
                        )}
                      </td>
                      <td className="text-right py-1.5">
                        {item.is_length_item ? (
                          <div className="flex items-center justify-end gap-1">
                            <Input
                              type="number"
                              step="0.5"
                              min="0.5"
                              value={item.length_metres || ""}
                              onChange={e => updateItem(idx, "length_metres", parseFloat(e.target.value) || 0)}
                              className="h-6 w-16 text-xs text-right px-1"
                            />
                            <span className="text-muted-foreground">m</span>
                          </div>
                        ) : (
                          <Input
                            type="number"
                            step="1"
                            min="1"
                            value={item.quantity}
                            onChange={e => updateItem(idx, "quantity", parseInt(e.target.value) || 1)}
                            className="h-6 w-14 text-xs text-right px-1 ml-auto"
                          />
                        )}
                      </td>
                      <td className="text-right py-1.5 text-muted-foreground">
                        R{unitCost.toFixed(2)}{item.is_length_item ? "/m" : ""}
                      </td>
                      <td className="text-right py-1.5 font-medium">R{lineTotal.toFixed(2)}</td>
                      <td className="text-center py-1.5">
                        <Checkbox
                          checked={item.is_optional}
                          onCheckedChange={(checked) => updateItem(idx, "is_optional", !!checked)}
                        />
                      </td>
                      <td className="py-1.5">
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeItem(idx)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2">
                  <td colSpan={4} className="py-2 text-right font-semibold text-sm">Bundle Total:</td>
                  <td className="py-2 text-right font-bold text-sm text-primary">R{bundleTotal.toFixed(2)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : isEditing ? "Update Bundle" : "Save Bundle"}
        </Button>
      </div>

      {/* Product Picker Dialog */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Product to Bundle</DialogTitle>
          </DialogHeader>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by code, name or description..."
              className="pl-9"
              autoFocus
            />
            {search && (
              <Button variant="ghost" size="icon" className="absolute right-1 top-1 h-7 w-7" onClick={() => setSearch("")}>
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <div className="max-h-[350px] overflow-y-auto space-y-1">
            {search.length < 2 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Type at least 2 characters to search...</p>
            ) : searchResults.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No products found</p>
            ) : (
              searchResults.map(p => (
                <div
                  key={p.id}
                  className="flex items-center justify-between p-2 rounded hover:bg-muted cursor-pointer text-sm"
                  onClick={() => addItem(p)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground shrink-0">{p.product_code}</span>
                      <span className="font-medium truncate text-xs">{p.short_name || p.description?.slice(0, 40)}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground flex gap-2 flex-wrap mt-0.5">
                      {p.pipe_size && <span>⌀ {p.pipe_size}</span>}
                      {p.suppliers?.name && <span>• {p.suppliers.name}</span>}
                      {p.sold_in_length && p.price_per_metre && (
                        <Badge variant="outline" className="text-[9px] h-4 border-green-500/50 text-green-700 bg-green-500/10 px-1">
                          📏 R{p.price_per_metre.toFixed(2)}/m
                        </Badge>
                      )}
                    </div>
                  </div>
                  <span className="text-xs font-medium ml-2 shrink-0">R{p.cost_price?.toFixed(2) || "0.00"}</span>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BundleBuilder;
