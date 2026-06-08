import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Plus, Receipt, Trash2, Loader2, Upload } from "lucide-react";
import browserImageCompression from "browser-image-compression";

const formatZAR = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

interface JobExpenseTrackerProps {
  leadId: string;
}

const JobExpenseTracker = ({ leadId }: JobExpenseTrackerProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(new Date().toISOString().split("T")[0]);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ["job-expenses", leadId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_expenses")
        .select("*")
        .eq("lead_id", leadId)
        .order("expense_date", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const totalExpenses = expenses.reduce((sum: number, e: any) => sum + Number(e.amount), 0);

  const addExpense = async () => {
    if (!description.trim() || !amount || Number(amount) <= 0) return;
    setSaving(true);
    try {
      if (!user) throw new Error("Not authenticated");

      let receiptPath: string | null = null;

      if (receiptFile) {
        const compressed = await browserImageCompression(receiptFile, {
          maxSizeMB: 1,
          maxWidthOrHeight: 1920,
          useWebWorker: true,
        });
        const path = `${leadId}/${Date.now()}-${receiptFile.name}`;
        const { error: uploadError } = await supabase.storage
          .from("expense-receipts")
          .upload(path, compressed);
        if (uploadError) throw uploadError;
        receiptPath = path;
      }

      const { error } = await supabase.from("job_expenses").insert({
        lead_id: leadId,
        description: description.trim(),
        amount: Number(amount),
        expense_date: expenseDate,
        receipt_path: receiptPath,
        created_by: user.id,
      });
      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ["job-expenses", leadId] });
      setDescription("");
      setAmount("");
      setReceiptFile(null);
      toast({ title: "Expense recorded" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const deleteExpense = async (id: string, receiptPath: string | null) => {
    try {
      if (receiptPath) {
        await supabase.storage.from("expense-receipts").remove([receiptPath]);
      }
      await supabase.from("job_expenses").delete().eq("id", id);
      queryClient.invalidateQueries({ queryKey: ["job-expenses", leadId] });
      toast({ title: "Expense deleted" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Receipt className="h-4 w-4" /> Job Expenses
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            Total: {formatZAR(totalExpenses)}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        {/* Expense list */}
        {expenses.length > 0 && (
          <div className="space-y-1">
            {expenses.map((exp: any) => (
              <div key={exp.id} className="flex items-center justify-between text-sm border rounded-md p-2">
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{exp.description}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(exp.expense_date).toLocaleDateString("en-ZA")}
                    {exp.receipt_path && " • 📎 Receipt"}
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-2">
                  <span className="font-mono font-medium">{formatZAR(Number(exp.amount))}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => deleteExpense(exp.id, exp.receipt_path)}
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add expense form */}
        <div className="border-t pt-3 space-y-2">
          <p className="text-xs font-medium">Add Expense</p>
          <Input
            placeholder="Description (e.g. Copper piping, Refrigerant R410A)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="h-8 text-sm"
          />
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
              <Label className="text-xs">Date</Label>
              <Input
                type="date"
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
                className="h-8 text-sm"
              />
            </div>
          </div>
          <Button variant="outline" size="sm" asChild className="w-full">
            <label className="cursor-pointer flex items-center justify-center gap-1">
              <Upload className="h-3.5 w-3.5" />
              {receiptFile ? receiptFile.name : "Attach Receipt"}
              <input type="file" accept="image/*" className="hidden" onChange={(e) => setReceiptFile(e.target.files?.[0] || null)} />
            </label>
          </Button>
          <Button size="sm" onClick={addExpense} disabled={saving} className="w-full">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
            Add Expense
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default JobExpenseTracker;
