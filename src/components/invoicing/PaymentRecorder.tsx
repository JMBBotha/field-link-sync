import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
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
import { Plus, DollarSign, Loader2 } from "lucide-react";

const formatZAR = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

interface PaymentRecorderProps {
  invoiceId: string;
  invoiceTotal: number;
}

const PaymentRecorder = ({ invoiceId, invoiceTotal }: PaymentRecorderProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("eft");
  const [reference, setReference] = useState("");
  const [adding, setAdding] = useState(false);

  const { data: payments = [], isLoading } = useQuery({
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

  const addPayment = async () => {
    if (!amount || Number(amount) <= 0) return;
    setAdding(true);
    try {
      const { error } = await supabase.from("payments").insert({
        invoice_id: invoiceId,
        amount: Number(amount),
        method,
        reference: reference || null,
        created_by: user?.id,
      });
      if (error) throw error;

      // Invoice status is auto-updated by the recalc_invoice_status trigger.
      queryClient.invalidateQueries({ queryKey: ["payments", invoiceId] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["invoice", invoiceId] });
      setAmount("");
      setReference("");
      toast({ title: "Payment recorded" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setAdding(false);
    }
  };

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <DollarSign className="h-4 w-4" /> Payments
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
          <div className="space-y-1 border-t pt-2">
            <p className="text-xs text-muted-foreground font-medium">History</p>
            {payments.map((p: any) => (
              <div key={p.id} className="flex justify-between text-xs">
                <span>
                  {new Date(p.payment_date).toLocaleDateString("en-ZA")} • {p.method.toUpperCase()}
                  {p.reference && ` • ${p.reference}`}
                </span>
                <span className="font-medium">{formatZAR(Number(p.amount))}</span>
              </div>
            ))}
          </div>
        )}

        {/* Add payment form */}
        {outstanding > 0 && (
          <div className="border-t pt-3 space-y-2">
            <p className="text-xs font-medium">Record Payment</p>
            <div className="grid grid-cols-2 gap-2">
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
            </div>
            <Input
              placeholder="Reference (optional)"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="h-8 text-sm"
            />
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
