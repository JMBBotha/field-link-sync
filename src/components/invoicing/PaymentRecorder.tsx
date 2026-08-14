import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useRole } from "@/hooks/useRole";
import { useUserCompanyId } from "@/hooks/useUserCompanyId";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Loader2, Pencil, Check, X, Trash2 } from "lucide-react";
import RandSign from "@/components/icons/RandSign";

const formatZAR = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

const toDateInput = (value: string | Date) => {
  const d = new Date(value);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
};

interface PaymentRecorderProps {
  invoiceId: string;
  invoiceTotal: number;
}

const PaymentRecorder = ({ invoiceId, invoiceTotal }: PaymentRecorderProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { isAdmin } = useRole();
  const { companyId } = useUserCompanyId();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("eft");
  const [reference, setReference] = useState("");
  const [paymentDate, setPaymentDate] = useState(toDateInput(new Date()));
  const [adding, setAdding] = useState(false);

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editMethod, setEditMethod] = useState("eft");
  const [editReference, setEditReference] = useState("");
  const [editDate, setEditDate] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const { data: payments = [] } = useQuery({
    queryKey: ["payments", invoiceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("*")
        .eq("invoice_id", invoiceId)
        .order("payment_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const totalPaid = payments.reduce((sum: number, p: any) => sum + Number(p.amount), 0);
  const outstanding = invoiceTotal - totalPaid;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["payments", invoiceId] });
    queryClient.invalidateQueries({ queryKey: ["invoices"] });
    queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId] });
  };

  const addPayment = async () => {
    const amt = Number(amount);
    if (!amount || amt <= 0) return;
    setAdding(true);

    const paymentsKey = ["payments", invoiceId];
    const invoiceKey = ["invoice", invoiceId];

    // Snapshot for rollback
    const prevPayments = queryClient.getQueryData<any[]>(paymentsKey);
    const prevInvoice = queryClient.getQueryData<any>(invoiceKey);
    const prevInvoicesLists = queryClient.getQueriesData<any[]>({ queryKey: ["invoices"] });

    const isoDate = new Date(`${paymentDate}T12:00:00`).toISOString();

    // Optimistic patch: prepend a temp payment row + flip invoice status if fully paid.
    const tempId = `temp-${Date.now()}`;
    const optimisticPayment = {
      id: tempId,
      invoice_id: invoiceId,
      amount: amt,
      method,
      reference: reference || null,
      payment_date: isoDate,
      _optimistic: true,
    };
    queryClient.setQueryData<any[]>(paymentsKey, (prev) => [optimisticPayment, ...(prev || [])]);

    const newPaid = totalPaid + amt;
    const nextStatus =
      newPaid + 0.005 >= invoiceTotal ? "paid" : newPaid > 0 ? "partially_paid" : prevInvoice?.status;

    if (prevInvoice) {
      queryClient.setQueryData(invoiceKey, { ...prevInvoice, status: nextStatus, amount_paid: newPaid });
    }
    prevInvoicesLists.forEach(([k, list]) => {
      if (!Array.isArray(list)) return;
      queryClient.setQueryData(
        k,
        list.map((inv: any) => (inv.id === invoiceId ? { ...inv, status: nextStatus } : inv)),
      );
    });

    setAmount("");
    setReference("");

    try {
      const { error } = await supabase.from("payments").insert({
        invoice_id: invoiceId,
        amount: amt,
        method,
        reference: reference || null,
        payment_date: isoDate,
        created_by: user?.id,
        ...(companyId ? { company_id: companyId } : {}),
      });
      if (error) throw error;

      // Invoice status is auto-updated by the recalc_invoice_status trigger.
      refresh();
      toast({ title: "Payment recorded" });
    } catch (err: any) {
      // Rollback
      queryClient.setQueryData(paymentsKey, prevPayments);
      if (prevInvoice) queryClient.setQueryData(invoiceKey, prevInvoice);
      prevInvoicesLists.forEach(([k, v]) => queryClient.setQueryData(k, v));
      toast({
        title: "Payment failed",
        description: err.message || "Reverted. Please try again.",
        variant: "destructive",
      });
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (p: any) => {
    setEditingId(p.id);
    setEditAmount(String(Number(p.amount)));
    setEditMethod(p.method || "eft");
    setEditReference(p.reference || "");
    setEditDate(toDateInput(p.payment_date));
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = async (paymentId: string) => {
    const amt = Number(editAmount);
    if (!editAmount || amt <= 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    setSavingEdit(true);
    try {
      const { error } = await supabase
        .from("payments")
        .update({
          amount: amt,
          method: editMethod,
          reference: editReference || null,
          payment_date: new Date(`${editDate}T12:00:00`).toISOString(),
        })
        .eq("id", paymentId);
      if (error) throw error;
      setEditingId(null);
      refresh();
      toast({ title: "Payment updated" });
    } catch (err: any) {
      toast({
        title: "Could not update payment",
        description: err.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSavingEdit(false);
    }
  };

  const deletePayment = async (paymentId: string) => {
    try {
      const { error } = await supabase.from("payments").delete().eq("id", paymentId);
      if (error) throw error;
      refresh();
      toast({ title: "Payment removed" });
    } catch (err: any) {
      toast({
        title: "Could not remove payment",
        description: err.message || "Only admins can delete payments.",
        variant: "destructive",
      });
    }
  };

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <RandSign className="h-4 w-4" /> Payments
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        {/* Outstanding */}
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Total</span>
          <span>{formatZAR(invoiceTotal)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Paid</span>
          <span className="text-green-600">{formatZAR(totalPaid)}</span>
        </div>
        <div className="flex justify-between text-sm font-bold">
          <span>Outstanding</span>
          <span className={outstanding > 0 ? "text-destructive" : "text-green-600"}>
            {formatZAR(outstanding)}
          </span>
        </div>

        {/* Payment history */}
        {payments.length > 0 && (
          <div className="space-y-1.5 border-t pt-2">
            <p className="text-xs text-muted-foreground font-medium">History</p>
            {payments.map((p: any) =>
              editingId === p.id ? (
                <div key={p.id} className="space-y-2 rounded-md border p-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Date</Label>
                      <Input
                        type="date"
                        value={editDate}
                        onChange={(e) => setEditDate(e.target.value)}
                        className="h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Amount (ZAR)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={editAmount}
                        onChange={(e) => setEditAmount(e.target.value)}
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Method</Label>
                      <Select value={editMethod} onValueChange={setEditMethod}>
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="eft">EFT</SelectItem>
                          <SelectItem value="cash">Cash</SelectItem>
                          <SelectItem value="card">Card</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Reference</Label>
                      <Input
                        value={editReference}
                        onChange={(e) => setEditReference(e.target.value)}
                        placeholder="Optional"
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" className="h-7 flex-1" disabled={savingEdit} onClick={() => saveEdit(p.id)}>
                      {savingEdit ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                      ) : (
                        <Check className="h-3.5 w-3.5 mr-1" />
                      )}
                      Save
                    </Button>
                    <Button size="sm" variant="outline" className="h-7" onClick={cancelEdit}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                    {isAdmin && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-destructive"
                        onClick={() => deletePayment(p.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <div key={p.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate">
                    {new Date(p.payment_date).toLocaleDateString("en-ZA")} • {String(p.method).toUpperCase()}
                    {p.reference && ` • ${p.reference}`}
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    <span className="font-medium">{formatZAR(Number(p.amount))}</span>
                    {!p._optimistic && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={() => startEdit(p)}
                        aria-label="Edit payment"
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                    )}
                  </span>
                </div>
              ),
            )}
          </div>
        )}

        {/* Add payment form */}
        {outstanding > 0 && (
          <div className="border-t pt-3 space-y-2">
            <p className="text-xs font-medium">Record Payment</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Payment date</Label>
                <Input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Amount (ZAR)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Method</Label>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="eft">EFT</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Reference</Label>
                <Input
                  placeholder="Optional"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            </div>
            <Button size="sm" onClick={addPayment} disabled={adding} className="w-full">
              {adding ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
              Record Payment
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default PaymentRecorder;
