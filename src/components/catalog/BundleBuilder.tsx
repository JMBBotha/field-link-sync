import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, GripVertical, Search, X } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const AC_TYPES = [
  "Midwall Inverter", "Midwall Fixed Speed", "Cassette", "Ducted",
  "Under Ceiling", "Floor Standing", "Portable",
];
const BTU_OPTIONS = [9000, 12000, 18000, 24000, 36000, 48000];
const PIPE_OPTIONS = ["1/4 x 3/8", "1/4 x 1/2", "1/4 x 5/8", "3/8 x 3/4"];

type BundleItemLocal = {
  id?: string;
  supplier_product_id: string;
  quantity: number;
  length_metres: number | null;
  is_length_item: boolean;
  notes: string;
  sort_order: number;
  // joined product info
  description: string;
  product_code: string;
  cost_price: number;
  price_per_metre: number | null;
  sold_in_length: boolean;
  supplier_name?: string;
};

type Props = {
  bundleId: string | null;
  onClose: () => void;
};

const BundleBuilder = ({ bundleId, onClose }: Props) => {
  const queryClient = useQueryClient();
  const isEditing = !!bundleId;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [acType, setAcType] = useState<string>("");
  const [btuRating, setBtuRating] = useState<string>("");
  const [pipeSize, setPipeSize] = useState<string>("");
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
        .select("*, supplier_products(description, product_code, cost_price, price_per_metre, sold_in_length, suppliers(name))")
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
      setAcType(existingBundle.ac_type || "");
      setBtuRating(existingBundle.btu_rating?.toString() || "");
      setPipeSize(existingBundle.pipe_size || "");
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
        notes: item.notes || "",
        sort_order: item.sort_order,
        description: item.supplier_products?.description || "",
        product_code: item.supplier_products?.product_code || "",
        cost_price: item.supplier_products?.cost_price || 0,
        price_per_metre: item.supplier_products?.price_per_metre,
        sold_in_length: item.supplier_products?.sold_in_length || false,
        supplier_name: item.supplier_products?.suppliers?.name,
      })));
    }
  }, [existingItems]);

  // Product search
  const { data: searchResults = [] } = useQuery({
    queryKey: ["bundle-product-search", search],
    enabled: search.length >= 2,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("supplier_products")
        .select("id, description, product_code, cost_price, price_per_metre, sold_in_length, suppliers(name)")
        .or("archived.is.null,archived.eq.false")
        .or(`description.ilike.%${search}%,product_code.ilike.%${search}%`)
        .limit(20);
      if (error) throw error;
      return data as any[];
    },
  });

  const addItem = (product: any) => {
    const alreadyAdded = items.some(i => i.supplier_product_id === product.id);
    if (alreadyAdded) {
      toast.info("Item already in bundle");
      return;
    }
    setItems(prev => [...prev, {
      supplier_product_id: product.id,
      quantity: product.sold_in_length ? 1 : 1,
      length_metres: product.sold_in_length ? 4 : null,
      is_length_item: product.sold_in_length,
      notes: "",
      sort_order: prev.length,
      description: product.description,
      product_code: product.product_code,
      cost_price: product.cost_price,
      price_per_metre: product.price_per_metre,
      sold_in_length: product.sold_in_length,
      supplier_name: product.suppliers?.name,
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

  const subtotal = items.reduce((sum, item) => {
    if (item.is_length_item && item.length_metres) {
      return sum + item.length_metres * (item.price_per_metre || 0);
    }
    return sum + item.quantity * item.cost_price;
  }, 0);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Bundle name is required");
      return;
    }
    setSaving(true);
    try {
      let bid: string;
      const bundleData = {
        name: name.trim(),
        description: description.trim() || null,
        ac_type: acType || null,
        btu_rating: btuRating ? parseInt(btuRating) : null,
        pipe_size: pipeSize || null,
      };

      if (isEditing) {
        const { error } = await supabase.from("installation_bundles").update(bundleData).eq("id", bundleId!);
        if (error) throw error;
        bid = bundleId!;
        // Delete old items and re-insert
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
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Samsung 12K Midwall Install Kit" />
        </div>
        <div>
          <Label className="text-xs">Description</Label>
          <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional description" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <Label className="text-xs">AC Type</Label>
            <Select value={acType} onValueChange={setAcType}>
              <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>
                {AC_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">BTU Rating</Label>
            <Select value={btuRating} onValueChange={setBtuRating}>
              <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>
                {BTU_OPTIONS.map(b => <SelectItem key={b} value={b.toString()}>{(b/1000).toFixed(0)}K</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Pipe Size</Label>
            <Select value={pipeSize} onValueChange={setPipeSize}>
              <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>
                {PIPE_OPTIONS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
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
                  <th className="w-6"></th>
                  <th className="text-left font-medium py-1.5">Product</th>
                  <th className="text-right font-medium py-1.5 w-24">Qty / Length</th>
                  <th className="text-right font-medium py-1.5 w-20">Unit Cost</th>
                  <th className="text-right font-medium py-1.5 w-20">Line Total</th>
                  <th className="text-left font-medium py-1.5 w-28 pl-2">Notes</th>
                  <th className="w-8"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const unitCost = item.is_length_item ? (item.price_per_metre || 0) : item.cost_price;
                  const qtyOrLen = item.is_length_item ? (item.length_metres || 0) : item.quantity;
                  const lineTotal = qtyOrLen * unitCost;
                  return (
                    <tr key={idx} className="border-b border-dashed">
                      <td className="py-1.5 text-muted-foreground"><GripVertical className="h-3 w-3" /></td>
                      <td className="py-1.5">
                        <div className="font-medium truncate max-w-[250px]">{item.description}</div>
                        {item.supplier_name && (
                          <span className="text-muted-foreground">{item.supplier_name}</span>
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
                      <td className="text-right py-1.5">
                        R{unitCost.toFixed(2)}{item.is_length_item ? "/m" : ""}
                      </td>
                      <td className="text-right py-1.5 font-medium">R{lineTotal.toFixed(2)}</td>
                      <td className="py-1.5 pl-2">
                        <Input
                          value={item.notes}
                          onChange={e => updateItem(idx, "notes", e.target.value)}
                          placeholder="note..."
                          className="h-6 text-xs px-1"
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
            </table>
          </div>
        )}

        {items.length > 0 && (
          <div className="flex justify-end mt-3 pt-2 border-t">
            <div className="text-sm">
              <span className="text-muted-foreground">Subtotal: </span>
              <span className="font-semibold">R{subtotal.toFixed(2)}</span>
            </div>
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
              placeholder="Search by code or description..."
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
                    <div className="font-medium truncate">{p.description}</div>
                    <div className="text-xs text-muted-foreground flex gap-2">
                      <span>{p.product_code}</span>
                      {p.suppliers?.name && <span>• {p.suppliers.name}</span>}
                      {p.sold_in_length && <span className="text-accent-foreground">📏 R{p.price_per_metre?.toFixed(2)}/m</span>}
                    </div>
                  </div>
                  <span className="text-xs font-medium ml-2 shrink-0">R{p.cost_price.toFixed(2)}</span>
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
