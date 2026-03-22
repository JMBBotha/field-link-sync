import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import {
  User, Building2, Phone, Mail, MapPin, ArrowLeft, Edit2, Plus,
  Wrench, FileCheck, Calendar, Star, Loader2,
} from "lucide-react";

const AdminCustomerDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [yearFilter, setYearFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showUnitDialog, setShowUnitDialog] = useState(false);
  const [unitForm, setUnitForm] = useState({ label: "", full_address: "", notes: "" });
  const [savingUnit, setSavingUnit] = useState(false);

  // Fetch customer
  const { data: customer, isLoading } = useQuery({
    queryKey: ["customer-detail", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
  });

  // Fetch units
  const { data: units = [] } = useQuery({
    queryKey: ["customer-units", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_units")
        .select("*")
        .eq("customer_id", id!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch jobs (leads)
  const { data: jobs = [] } = useQuery({
    queryKey: ["customer-jobs", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("id, service_type, status, created_at, completed_at, scheduled_date, assigned_agent_id, notes, customer_address")
        .eq("customer_id", id!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch agreements
  const { data: agreements = [] } = useQuery({
    queryKey: ["customer-agreements", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("service_agreements")
        .select("id, contract_type, frequency, start_date, end_date, price, status, next_service_due")
        .eq("customer_id", id!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Fetch feedback
  const { data: feedback = [] } = useQuery({
    queryKey: ["customer-feedback", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_feedback")
        .select("rating, comment, created_at")
        .eq("customer_id", id!)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data || [];
    },
  });

  const handleAddUnit = async () => {
    if (!unitForm.label || !id) return;
    setSavingUnit(true);
    try {
      const { error } = await supabase.from("customer_units").insert({
        customer_id: id,
        label: unitForm.label,
        full_address: unitForm.full_address || null,
        notes: unitForm.notes || null,
      });
      if (error) throw error;
      toast({ title: "Unit Added ✅" });
      queryClient.invalidateQueries({ queryKey: ["customer-units", id] });
      setShowUnitDialog(false);
      setUnitForm({ label: "", full_address: "", notes: "" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSavingUnit(false);
    }
  };

  // Filter jobs
  const filteredJobs = jobs.filter((j) => {
    if (yearFilter !== "all") {
      const year = new Date(j.created_at || "").getFullYear().toString();
      if (year !== yearFilter) return false;
    }
    if (statusFilter !== "all" && j.status !== statusFilter) return false;
    return true;
  });

  const jobYears = [...new Set(jobs.map((j) => new Date(j.created_at || "").getFullYear().toString()))].sort().reverse();

  const avgRating = feedback.length
    ? (feedback.reduce((s, f) => s + f.rating, 0) / feedback.length).toFixed(1)
    : null;

  const statusBadge: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-700",
    lead: "bg-amber-100 text-amber-700",
    inactive: "bg-muted text-muted-foreground",
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-4 max-w-5xl mx-auto">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Customer not found</p>
        <Button variant="outline" onClick={() => navigate(-1)} className="mt-4">Go Back</Button>
      </div>
    );
  }

  const displayName = customer.is_company && customer.company_name
    ? customer.company_name
    : `${customer.first_name || ""} ${customer.last_name || ""}`.trim() || customer.name;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      {/* Back */}
      <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1">
        <ArrowLeft className="h-4 w-4" /> Back
      </Button>

      {/* Header */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              {customer.is_company ? <Building2 className="h-6 w-6 text-primary" /> : <User className="h-6 w-6 text-primary" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold">{displayName}</h1>
                <Badge variant="outline" className={cn("text-xs", statusBadge[customer.status || "lead"])}>
                  {customer.status || "lead"}
                </Badge>
              </div>
              {customer.is_company && customer.first_name && (
                <p className="text-sm text-muted-foreground">Contact: {customer.first_name} {customer.last_name}</p>
              )}
              <div className="flex flex-wrap items-center gap-3 mt-2 text-sm text-muted-foreground">
                <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{customer.phone}</span>
                {customer.secondary_phone && <span className="flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{customer.secondary_phone}</span>}
                {customer.email && <span className="flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{customer.email}</span>}
                {customer.primary_address_line1 && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5" />
                    {[customer.primary_address_line1, customer.primary_address_line2, customer.city, customer.postal_code].filter(Boolean).join(", ")}
                  </span>
                )}
              </div>
              <div className="flex gap-4 mt-3 text-sm">
                <div><span className="text-muted-foreground">Jobs:</span> <span className="font-semibold">{jobs.length}</span></div>
                <div><span className="text-muted-foreground">Agreements:</span> <span className="font-semibold">{agreements.length}</span></div>
                {avgRating && <div className="flex items-center gap-1"><Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" /> {avgRating}</div>}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Units Section */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" /> Units / Locations</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setShowUnitDialog(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Unit
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {units.length === 0 ? (
            <p className="text-sm text-muted-foreground">No units/locations added yet.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {units.map((u: any) => (
                <div key={u.id} className="border rounded-lg p-3">
                  <p className="font-medium text-sm">{u.label}</p>
                  {u.full_address && <p className="text-xs text-muted-foreground">{u.full_address}</p>}
                  {u.notes && <p className="text-xs text-muted-foreground mt-1">{u.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Job History */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base flex items-center gap-2"><Wrench className="h-4 w-4 text-primary" /> Job History</CardTitle>
            <div className="flex gap-2">
              <Select value={yearFilter} onValueChange={setYearFilter}>
                <SelectTrigger className="w-24 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Years</SelectItem>
                  {jobYears.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-28 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="accepted">Accepted</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {filteredJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No jobs found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-left">
                    <th className="pb-2 font-medium">Date</th>
                    <th className="pb-2 font-medium">Service</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium hidden sm:table-cell">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredJobs.map((j) => (
                    <tr key={j.id} className="border-b last:border-0 hover:bg-muted/30 cursor-pointer" onClick={() => navigate(`/admin`)}>
                      <td className="py-2 pr-3">{j.created_at ? format(new Date(j.created_at), "dd MMM yyyy") : "—"}</td>
                      <td className="py-2 pr-3">{j.service_type}</td>
                      <td className="py-2 pr-3">
                        <Badge variant="outline" className="text-xs">{j.status}</Badge>
                      </td>
                      <td className="py-2 text-muted-foreground truncate max-w-[200px] hidden sm:table-cell">{j.notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Agreements */}
      {agreements.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2"><FileCheck className="h-4 w-4 text-primary" /> Service Agreements</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {agreements.map((a: any) => (
                <div key={a.id} className="flex items-center justify-between border rounded-lg p-3">
                  <div>
                    <p className="text-sm font-medium">{a.contract_type}</p>
                    <p className="text-xs text-muted-foreground">{a.start_date} → {a.end_date} • {a.frequency}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold">R {Number(a.price).toLocaleString()}</p>
                    <Badge variant="outline" className="text-[10px]">{a.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Add Unit Dialog */}
      <Dialog open={showUnitDialog} onOpenChange={setShowUnitDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Unit / Location</DialogTitle>
            <DialogDescription>Add a site or equipment location for this customer</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Label *</Label>
              <Input value={unitForm.label} onChange={(e) => setUnitForm(p => ({ ...p, label: e.target.value }))} placeholder="e.g. Flat 3, Block B" />
            </div>
            <div className="space-y-2">
              <Label>Full Address (optional)</Label>
              <Input value={unitForm.full_address} onChange={(e) => setUnitForm(p => ({ ...p, full_address: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Notes (optional)</Label>
              <Input value={unitForm.notes} onChange={(e) => setUnitForm(p => ({ ...p, notes: e.target.value }))} placeholder="Access codes, equipment notes..." />
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowUnitDialog(false)} className="flex-1">Cancel</Button>
            <Button onClick={handleAddUnit} disabled={savingUnit || !unitForm.label} className="flex-1">
              {savingUnit && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Add Unit
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminCustomerDetailPage;
