import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Trash2, Search, Save, Send } from "lucide-react";

interface SupplierProduct {
  id: string;
  name: string;
  selling_price: number | null;
  description: string | null;
  product_code: string | null;
  short_name: string | null;
}

interface LineItem {
  product_id: string;
  name: string;
  qty: number;
  price: number;
}

const COMPANY_ID = "b8566007-f29c-46a5-97c9-cca365e638c7";

export default function AdminManualQuotePage() {
  const [products, setProducts] = useState<SupplierProduct[]>([]);
  const [search, setSearch] = useState("");
  const [items, setItems] = useState<LineItem[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    supabase
      .from("supplier_products")
      .select("id, name, selling_price, description, product_code, short_name")
      .eq("is_active", true)
      .order("name")
      .limit(500)
      .then(({ data }) => setProducts(data || []));
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return products.slice(0, 20);
    const q = search.toLowerCase();
    return products
      .filter(
        (p) =>
          p.name?.toLowerCase().includes(q) ||
          p.short_name?.toLowerCase().includes(q) ||
          p.product_code?.toLowerCase().includes(q) ||
          p.description?.toLowerCase().includes(q)
      )
      .slice(0, 20);
  }, [search, products]);

  const addItem = (p: SupplierProduct) => {
    if (items.find((i) => i.product_id === p.id)) {
      setItems(items.map((i) => (i.product_id === p.id ? { ...i, qty: i.qty + 1 } : i)));
    } else {
      setItems([...items, { product_id: p.id, name: p.short_name || p.name, qty: 1, price: p.selling_price || 0 }]);
    }
  };

  const updateQty = (idx: number, qty: number) => {
    const n = [...items];
    n[idx].qty = Math.max(1, qty);
    setItems(n);
  };

  const updatePrice = (idx: number, price: number) => {
    const n = [...items];
    n[idx].price = Math.max(0, price);
    setItems(n);
  };

  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));

  const total = items.reduce((s, i) => s + i.qty * i.price, 0);

  const handleSave = async (andSend = false) => {
    if (!customerName.trim()) return toast.error("Please assign a client before saving this quote.");
    if (items.length === 0) return toast.error("Add at least one item");

    setSaving(true);
    if (andSend) setSending(true);

    try {
      const areas = items.map((i) => ({
        name: "Manual",
        unit: i.name,
        quantity: i.qty,
        unit_price: i.price,
      }));

      const { data, error } = await supabase
        .from("proposals")
        .insert({
          company_id: COMPANY_ID,
          status: andSend ? "Sent" : "Draft",
          total_amount: total,
          total: total,
          areas,
          source: "manual",
        })
        .select("id")
        .single();

      if (error) throw error;

      if (andSend && customerEmail) {
        try {
          await supabase.functions.invoke("send-quote-email", {
            body: {
              to: customerEmail,
              customerName,
              quoteNumber: `MQ-${Date.now().toString(36).toUpperCase()}`,
              totalAmount: total,
              areas,
            },
          });
          toast.success("Quote saved and emailed!");
        } catch {
          toast.success("Quote saved! Email sending failed — you can resend later.");
        }
      } else {
        toast.success("Quote saved as draft!");
      }

      // Reset form
      setItems([]);
      setCustomerName("");
      setCustomerPhone("");
      setCustomerEmail("");
      setNotes("");
    } catch (err: any) {
      toast.error(err.message || "Error saving quote");
    } finally {
      setSaving(false);
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Create Manual Quote</h1>
        <p className="text-muted-foreground text-sm">
          Use this form to create quotes manually while WhatsApp integration is pending verification.
        </p>
      </div>

      {/* Customer Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Customer Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label>Name *</Label>
            <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Customer name" />
          </div>
          <div>
            <Label>Phone</Label>
            <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="+27..." />
          </div>
          <div>
            <Label>Email</Label>
            <Input value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} placeholder="email@example.com" type="email" />
          </div>
        </CardContent>
      </Card>

      {/* Product Search */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add Products</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products by name, code, or description…"
              className="pl-9"
            />
          </div>
          {filtered.length > 0 && (
            <div className="border rounded-md max-h-48 overflow-y-auto divide-y">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-muted/50 text-left"
                  onClick={() => addItem(p)}
                >
                  <span className="truncate">
                    {p.short_name || p.name}
                    {p.product_code && <span className="text-muted-foreground ml-2">({p.product_code})</span>}
                  </span>
                  <span className="text-muted-foreground shrink-0 ml-3">
                    R{(p.selling_price || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                  </span>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Line Items */}
      {items.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Line Items</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="w-28">Price (R)</TableHead>
                  <TableHead className="w-20">Qty</TableHead>
                  <TableHead className="w-28 text-right">Subtotal</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        value={item.price}
                        onChange={(e) => updatePrice(idx, parseFloat(e.target.value) || 0)}
                        className="h-8 w-24"
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        value={item.qty}
                        onChange={(e) => updateQty(idx, parseInt(e.target.value) || 1)}
                        min={1}
                        className="h-8 w-16"
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      R{(item.qty * item.price).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeItem(idx)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="mt-4 flex justify-end">
              <div className="text-lg font-bold">
                Total: R{total.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Notes & Actions */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div>
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any additional notes…" rows={3} />
          </div>
          <div className="flex gap-3">
            <Button onClick={() => handleSave(false)} disabled={saving}>
              <Save className="h-4 w-4 mr-2" />
              {saving && !sending ? "Saving…" : "Save as Draft"}
            </Button>
            <Button variant="secondary" onClick={() => handleSave(true)} disabled={saving || !customerEmail}>
              <Send className="h-4 w-4 mr-2" />
              {sending ? "Sending…" : "Save & Email Quote"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
