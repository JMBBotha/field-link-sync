import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Search, Plus, BookOpen, Clock, Edit2, Check, X } from "lucide-react";
import { useRole } from "@/hooks/useRole";

const formatZAR = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

interface FlatRateBookProps {
  mode?: "page" | "picker";
  onAddToQuote?: (item: { description: string; quantity: number; unit_price: number }) => void;
}

const FlatRateBook = ({ mode = "page", onAddToQuote }: FlatRateBookProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { roles } = useRole();
  const isAdmin = roles.includes("admin");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [newItem, setNewItem] = useState({ category: "", name: "", description: "", standard_price: "", estimated_hours: "" });

  const { data: items = [] } = useQuery({
    queryKey: ["flat-rate-items"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("flat_rate_items")
        .select("*")
        .eq("is_active", true)
        .order("category, name");
      if (error) throw error;
      return data;
    },
  });

  const categories = [...new Set(items.map((i: any) => i.category))];

  const filtered = items.filter((item: any) => {
    const matchesSearch = !search || item.name.toLowerCase().includes(search.toLowerCase()) || item.description?.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = categoryFilter === "all" || item.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const updatePrice = useMutation({
    mutationFn: async ({ id, price }: { id: string; price: number }) => {
      const { error } = await supabase.from("flat_rate_items").update({ standard_price: price }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flat-rate-items"] });
      setEditingId(null);
      toast({ title: "Price updated" });
    },
  });

  const addItem = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("flat_rate_items").insert({
        category: newItem.category,
        name: newItem.name,
        description: newItem.description || null,
        standard_price: parseFloat(newItem.standard_price),
        estimated_hours: newItem.estimated_hours ? parseFloat(newItem.estimated_hours) : null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["flat-rate-items"] });
      setShowAddForm(false);
      setNewItem({ category: "", name: "", description: "", standard_price: "", estimated_hours: "" });
      toast({ title: "Item added" });
    },
  });

  return (
    <div className={mode === "picker" ? "space-y-3" : "max-w-6xl mx-auto p-4 space-y-4"}>
      {mode === "page" && (
        <div className="flex items-center gap-3">
          <BookOpen className="h-6 w-6 text-primary" />
          <h2 className="text-xl font-bold">Flat Rate Pricing Book</h2>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search items..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isAdmin && mode === "page" && (
          <Button onClick={() => setShowAddForm(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add Item
          </Button>
        )}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden sm:table-cell">Category</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="hidden sm:table-cell text-center">Est. Hours</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((item: any) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <div>
                      <div className="font-medium text-sm">{item.name}</div>
                      {item.description && (
                        <div className="text-xs text-muted-foreground line-clamp-1">{item.description}</div>
                      )}
                      <Badge variant="outline" className="sm:hidden text-xs mt-1">{item.category}</Badge>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Badge variant="outline">{item.category}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {editingId === item.id ? (
                      <div className="flex items-center gap-1 justify-end">
                        <Input
                          type="number"
                          value={editPrice}
                          onChange={(e) => setEditPrice(e.target.value)}
                          className="w-24 h-7 text-sm text-right"
                        />
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => updatePrice.mutate({ id: item.id, price: parseFloat(editPrice) })}>
                          <Check className="h-3 w-3" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingId(null)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 justify-end">
                        <span className="font-medium">{formatZAR(Number(item.standard_price))}</span>
                        {isAdmin && mode === "page" && (
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => { setEditingId(item.id); setEditPrice(String(item.standard_price)); }}>
                            <Edit2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-center">
                    {item.estimated_hours ? (
                      <span className="flex items-center justify-center gap-1 text-sm text-muted-foreground">
                        <Clock className="h-3 w-3" /> {item.estimated_hours}h
                      </span>
                    ) : "—"}
                  </TableCell>
                  <TableCell>
                    {onAddToQuote && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => onAddToQuote({ description: item.name, quantity: 1, unit_price: Number(item.standard_price) })}
                      >
                        <Plus className="h-3 w-3 mr-1" /> Add
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No items found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Add Item Dialog */}
      <Dialog open={showAddForm} onOpenChange={setShowAddForm}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Flat Rate Item</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Category</Label>
              <Input value={newItem.category} onChange={(e) => setNewItem({ ...newItem, category: e.target.value })} placeholder="e.g. Installation, Repair, Service" />
            </div>
            <div>
              <Label>Name</Label>
              <Input value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} placeholder="Item name" />
            </div>
            <div>
              <Label>Description</Label>
              <Input value={newItem.description} onChange={(e) => setNewItem({ ...newItem, description: e.target.value })} placeholder="Optional description" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Price (ZAR)</Label>
                <Input type="number" value={newItem.standard_price} onChange={(e) => setNewItem({ ...newItem, standard_price: e.target.value })} />
              </div>
              <div>
                <Label>Est. Hours</Label>
                <Input type="number" step="0.5" value={newItem.estimated_hours} onChange={(e) => setNewItem({ ...newItem, estimated_hours: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => addItem.mutate()} disabled={!newItem.name || !newItem.category || !newItem.standard_price}>
              Add Item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default FlatRateBook;
