import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart3 } from "lucide-react";
import RevenueReport from "./RevenueReport";
import TaxReport from "./TaxReport";
import AgentUtilizationReport from "./AgentUtilizationReport";

const ReportBuilder = () => {
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split("T")[0]);

  return (
    <div className="min-h-screen bg-muted/30 p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground tracking-tight flex items-center gap-2">
          <BarChart3 className="h-7 w-7 text-primary" /> Reports
        </h1>
        <p className="text-muted-foreground mt-1">Generate business reports & exports</p>
      </div>

      {/* Date Range */}
      <Card className="rounded-2xl shadow-md border-0">
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <Label className="text-xs">Start Date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-44" />
            </div>
            <div>
              <Label className="text-xs">End Date</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="w-44" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="revenue" className="space-y-4">
        <TabsList>
          <TabsTrigger value="revenue">Revenue</TabsTrigger>
          <TabsTrigger value="tax">Tax (SARS)</TabsTrigger>
          <TabsTrigger value="utilization">Agent Utilization</TabsTrigger>
        </TabsList>

        <TabsContent value="revenue">
          <RevenueReport startDate={startDate} endDate={endDate} />
        </TabsContent>
        <TabsContent value="tax">
          <TaxReport startDate={startDate} endDate={endDate} />
        </TabsContent>
        <TabsContent value="utilization">
          <AgentUtilizationReport startDate={startDate} endDate={endDate} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ReportBuilder;
