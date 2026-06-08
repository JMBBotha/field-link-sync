import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Database, Loader2, Trash2, CheckCircle2, AlertTriangle } from "lucide-react";
import { generateSampleData, clearSampleData, SampleDataResult } from "@/lib/sampleDataGenerator";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

const SampleDataLoader = () => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [result, setResult] = useState<SampleDataResult | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const handleLoad = async () => {
    setLoading(true);
    setResult(null);
    try {
      if (!user) throw new Error("You must be logged in to generate sample data");
      const res = await generateSampleData(user.id);
      setResult(res);
      queryClient.invalidateQueries();
      toast({
        title: "Sample data loaded ✅",
        description: `${res.leads} leads, ${res.customers} customers, ${res.products} products created`,
      });
    } catch (err: any) {
      toast({
        title: "Failed to load sample data",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    setClearing(true);
    try {
      await clearSampleData();
      setResult(null);
      queryClient.invalidateQueries();
      toast({ title: "Sample data cleared 🗑️" });
    } catch (err: any) {
      toast({
        title: "Failed to clear sample data",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setClearing(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Database className="h-4 w-4" />
          Sample Data Generator
        </CardTitle>
        <CardDescription>
          Load realistic demo data — 10 leads around Cape Town, 5 customers, 20 Midea products, agreements, invoices & feedback.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            This inserts real records into your database. Use "Clear Sample Data" to remove them when done.
          </AlertDescription>
        </Alert>

        <div className="flex flex-wrap gap-2">
          <Button onClick={handleLoad} disabled={loading || clearing}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}
            {loading ? "Generating…" : "Load Sample Data"}
          </Button>
          <Button variant="outline" onClick={handleClear} disabled={loading || clearing}>
            {clearing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
            {clearing ? "Clearing…" : "Clear Sample Data"}
          </Button>
        </div>

        {result && (
          <div className="flex flex-wrap gap-2 pt-2">
            <Badge variant="secondary" className="gap-1">
              <CheckCircle2 className="h-3 w-3" /> {result.customers} Customers
            </Badge>
            <Badge variant="secondary" className="gap-1">
              <CheckCircle2 className="h-3 w-3" /> {result.leads} Leads
            </Badge>
            <Badge variant="secondary" className="gap-1">
              <CheckCircle2 className="h-3 w-3" /> {result.products} Products
            </Badge>
            <Badge variant="secondary" className="gap-1">
              <CheckCircle2 className="h-3 w-3" /> {result.agreements} Agreements
            </Badge>
            <Badge variant="secondary" className="gap-1">
              <CheckCircle2 className="h-3 w-3" /> {result.invoices} Invoices
            </Badge>
            <Badge variant="secondary" className="gap-1">
              <CheckCircle2 className="h-3 w-3" /> {result.feedback} Feedback
            </Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default SampleDataLoader;
