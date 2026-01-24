import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { 
  Plus, 
  Calendar as CalendarIcon, 
  FileText, 
  DollarSign, 
  AlertTriangle,
  RefreshCw,
  Loader2,
  Search,
  Download,
  X,
  Clock,
  Users
} from "lucide-react";
import { format, addMonths, addYears } from "date-fns";
import { cn } from "@/lib/utils";

interface Customer {
  id: string;
  name: string;
  phone: string;
  address: string | null;
}

interface Equipment {
  id: string;
  type: string;
  brand: string | null;
  model: string | null;
  location: string | null;
}

interface Agreement {
  id: string;
  customer_id: string;
  equipment_id: string | null;
  contract_type: string;
  contract_type_custom: string | null;
  frequency: string;
  start_date: string;
  end_date: string;
  price: number;
  status: string;
  auto_generate_jobs: boolean;
  next_service_due: string | null;
  last_service_date: string | null;
  notes: string | null;
  created_at: string;
  customers?: { name: string; phone: string };
  equipment?: { type: string; brand: string | null; model: string | null };
}

const CONTRACT_TYPES = [
  { value: "annual_ac_maintenance", label: "Annual AC Maintenance" },
  { value: "biannual_heater_check", label: "Bi-Annual Heater Check" },
  { value: "quarterly_filter", label: "Quarterly Filter Service" },
  { value: "monthly_checkup", label: "Monthly Checkup" },
  { value: "custom", label: "Custom" },
];

const FREQUENCIES = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly (Every 3 months)" },
  { value: "biannual", label: "Bi-Annual (Every 6 months)" },
  { value: "annual", label: "Annual" },
];

const STATUS_BADGES: Record<string, { bg: string; label: string }> = {
  active: { bg: "bg-green-500", label: "Active" },
  expired: { bg: "bg-gray-500", label: "Expired" },
  cancelled: { bg: "bg-red-500", label: "Cancelled" },
  pending_renewal: { bg: "bg-orange-500", label: "Renewing Soon" },
};

const ServiceAgreements = () => {
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingAgreement, setEditingAgreement] = useState<Agreement | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expiringCount, setExpiringCount] = useState(0);
  const [totalActiveValue, setTotalActiveValue] = useState(0);
  const { toast } = useToast();

  // Form state
  const [formData, setFormData] = useState({
    customer_id: "",
    equipment_id: "",
    contract_type: "annual_ac_maintenance",
    contract_type_custom: "",
    frequency: "annual",
    start_date: new Date(),
    end_date: addYears(new Date(), 1),
    price: 0,
    auto_generate_jobs: true,
    notes: "",
  });
  const [customerEquipment, setCustomerEquipment] = useState<Equipment[]>([]);
  const [saving, setSaving] = useState(false);

  const fetchAgreements = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("service_agreements")
        .select(`
          *,
          customers:customer_id (name, phone),
          equipment:equipment_id (type, brand, model)
        `)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setAgreements(data || []);

      // Calculate stats
      const active = (data || []).filter(a => a.status === "active");
      setTotalActiveValue(active.reduce((sum, a) => sum + Number(a.price), 0));
      setExpiringCount((data || []).filter(a => a.status === "pending_renewal").length);
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const fetchCustomers = useCallback(async () => {
    const { data } = await supabase
      .from("customers")
      .select("id, name, phone, address")
      .order("name");
    setCustomers(data || []);
  }, []);

  const fetchEquipmentForCustomer = useCallback(async (customerId: string) => {
    if (!customerId) {
      setCustomerEquipment([]);
      return;
    }
    const { data } = await supabase
      .from("equipment")
      .select("id, type, brand, model, location")
      .eq("customer_id", customerId);
    setCustomerEquipment(data || []);
  }, []);

  useEffect(() => {
    fetchAgreements();
    fetchCustomers();

    // Subscribe to changes
    const channel = supabase
      .channel("agreements-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "service_agreements" }, fetchAgreements)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchAgreements, fetchCustomers]);

  useEffect(() => {
    fetchEquipmentForCustomer(formData.customer_id);
  }, [formData.customer_id, fetchEquipmentForCustomer]);

  const resetForm = () => {
    setFormData({
      customer_id: "",
      equipment_id: "",
      contract_type: "annual_ac_maintenance",
      contract_type_custom: "",
      frequency: "annual",
      start_date: new Date(),
      end_date: addYears(new Date(), 1),
      price: 0,
      auto_generate_jobs: true,
      notes: "",
    });
    setEditingAgreement(null);
    setCustomerEquipment([]);
  };

  const openEditForm = (agreement: Agreement) => {
    setEditingAgreement(agreement);
    setFormData({
      customer_id: agreement.customer_id,
      equipment_id: agreement.equipment_id || "",
      contract_type: agreement.contract_type,
      contract_type_custom: agreement.contract_type_custom || "",
      frequency: agreement.frequency,
      start_date: new Date(agreement.start_date),
      end_date: new Date(agreement.end_date),
      price: agreement.price,
      auto_generate_jobs: agreement.auto_generate_jobs,
      notes: agreement.notes || "",
    });
    fetchEquipmentForCustomer(agreement.customer_id);
    setShowForm(true);
  };

  const handleSubmit = async () => {
    if (!formData.customer_id) {
      toast({ title: "Error", description: "Please select a customer", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      // Calculate next service due date based on start date and frequency
      let nextServiceDue = formData.start_date;
      
      const agreementData = {
        customer_id: formData.customer_id,
        equipment_id: formData.equipment_id || null,
        contract_type: formData.contract_type,
        contract_type_custom: formData.contract_type === "custom" ? formData.contract_type_custom : null,
        frequency: formData.frequency,
        start_date: format(formData.start_date, "yyyy-MM-dd"),
        end_date: format(formData.end_date, "yyyy-MM-dd"),
        price: formData.price,
        auto_generate_jobs: formData.auto_generate_jobs,
        next_service_due: format(nextServiceDue, "yyyy-MM-dd"),
        notes: formData.notes || null,
        created_by: user?.id,
        updated_at: new Date().toISOString(),
      };

      if (editingAgreement) {
        const { error } = await supabase
          .from("service_agreements")
          .update(agreementData)
          .eq("id", editingAgreement.id);
        if (error) throw error;
        toast({ title: "Agreement Updated ✅", description: "Service agreement has been updated" });
      } else {
        const { error } = await supabase
          .from("service_agreements")
          .insert(agreementData);
        if (error) throw error;
        toast({ title: "Agreement Created 🎉", description: "New service agreement has been created" });
      }

      setShowForm(false);
      resetForm();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async (id: string) => {
    try {
      const { error } = await supabase
        .from("service_agreements")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
      toast({ title: "Agreement Cancelled", description: "The service agreement has been cancelled" });
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
    setDeleteConfirm(null);
  };

  const handleRenew = (agreement: Agreement) => {
    setFormData({
      customer_id: agreement.customer_id,
      equipment_id: agreement.equipment_id || "",
      contract_type: agreement.contract_type,
      contract_type_custom: agreement.contract_type_custom || "",
      frequency: agreement.frequency,
      start_date: new Date(agreement.end_date),
      end_date: addYears(new Date(agreement.end_date), 1),
      price: agreement.price,
      auto_generate_jobs: agreement.auto_generate_jobs,
      notes: agreement.notes || "",
    });
    fetchEquipmentForCustomer(agreement.customer_id);
    setShowForm(true);
    toast({ title: "Renewing Agreement", description: "Creating renewal based on existing contract" });
  };

  const exportToCSV = () => {
    const headers = ["Customer", "Contract Type", "Frequency", "Start Date", "End Date", "Price", "Status", "Next Service"];
    const rows = filteredAgreements.map(a => [
      a.customers?.name || "",
      CONTRACT_TYPES.find(t => t.value === a.contract_type)?.label || a.contract_type_custom || a.contract_type,
      FREQUENCIES.find(f => f.value === a.frequency)?.label || a.frequency,
      a.start_date,
      a.end_date,
      a.price.toString(),
      a.status,
      a.next_service_due || "",
    ]);

    const csv = [headers, ...rows].map(row => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `service-agreements-${format(new Date(), "yyyy-MM-dd")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const filteredAgreements = agreements.filter(a => {
    if (statusFilter !== "all" && a.status !== statusFilter) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        a.customers?.name?.toLowerCase().includes(query) ||
        a.contract_type.toLowerCase().includes(query) ||
        a.contract_type_custom?.toLowerCase().includes(query)
      );
    }
    return true;
  });

  const getContractLabel = (agreement: Agreement) => {
    if (agreement.contract_type === "custom" && agreement.contract_type_custom) {
      return agreement.contract_type_custom;
    }
    return CONTRACT_TYPES.find(t => t.value === agreement.contract_type)?.label || agreement.contract_type;
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header with Stats */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Service Agreements
          </h2>
          <p className="text-sm text-muted-foreground">Manage recurring maintenance contracts</p>
        </div>

        <div className="flex flex-wrap gap-3">
          <Card className="px-4 py-2 flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-green-600" />
            <div>
              <p className="text-xs text-muted-foreground">Active Revenue</p>
              <p className="font-semibold text-sm">R {totalActiveValue.toLocaleString()}</p>
            </div>
          </Card>
          {expiringCount > 0 && (
            <Card className="px-4 py-2 flex items-center gap-2 border-orange-200 bg-orange-50">
              <AlertTriangle className="h-4 w-4 text-orange-600" />
              <div>
                <p className="text-xs text-orange-700">Expiring Soon</p>
                <p className="font-semibold text-sm text-orange-800">{expiringCount} contracts</p>
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* Filters & Actions */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by customer or contract type..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full md:w-40">
            <SelectValue placeholder="Filter status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="pending_renewal">Renewing Soon</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={exportToCSV} className="gap-2">
          <Download className="h-4 w-4" />
          Export
        </Button>
        <Button onClick={() => { resetForm(); setShowForm(true); }} className="gap-2">
          <Plus className="h-4 w-4" />
          New Agreement
        </Button>
      </div>

      {/* Agreements List */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : filteredAgreements.length === 0 ? (
        <Card className="p-8 text-center">
          <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">No service agreements found</p>
          <Button onClick={() => { resetForm(); setShowForm(true); }} className="mt-4">
            Create First Agreement
          </Button>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredAgreements.map((agreement) => {
            const statusInfo = STATUS_BADGES[agreement.status] || STATUS_BADGES.active;
            return (
              <Card key={agreement.id} className="relative overflow-hidden">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-base">{agreement.customers?.name}</CardTitle>
                      <CardDescription>{getContractLabel(agreement)}</CardDescription>
                    </div>
                    <Badge className={cn(statusInfo.bg, "text-white text-xs")}>
                      {statusInfo.label}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Frequency</p>
                      <p className="font-medium">{FREQUENCIES.find(f => f.value === agreement.frequency)?.label}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Annual Value</p>
                      <p className="font-medium text-green-600">R {Number(agreement.price).toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Start Date</p>
                      <p>{format(new Date(agreement.start_date), "dd MMM yyyy")}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">End Date</p>
                      <p>{format(new Date(agreement.end_date), "dd MMM yyyy")}</p>
                    </div>
                  </div>
                  {agreement.next_service_due && (
                    <div className="flex items-center gap-2 text-sm bg-muted/50 rounded-md px-2 py-1">
                      <Clock className="h-3.5 w-3.5 text-primary" />
                      <span className="text-muted-foreground">Next service:</span>
                      <span className="font-medium">{format(new Date(agreement.next_service_due), "dd MMM yyyy")}</span>
                    </div>
                  )}
                  {agreement.equipment && (
                    <div className="text-xs text-muted-foreground">
                      Equipment: {agreement.equipment.brand} {agreement.equipment.model} ({agreement.equipment.type})
                    </div>
                  )}
                  <div className="flex gap-2 pt-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => openEditForm(agreement)}>
                      Edit
                    </Button>
                    {agreement.status === "active" || agreement.status === "pending_renewal" ? (
                      <>
                        <Button variant="outline" size="sm" onClick={() => handleRenew(agreement)}>
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setDeleteConfirm(agreement.id)}>
                          <X className="h-3.5 w-3.5 text-red-500" />
                        </Button>
                      </>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={showForm} onOpenChange={(open) => { if (!open) resetForm(); setShowForm(open); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingAgreement ? "Edit Agreement" : "New Service Agreement"}</DialogTitle>
            <DialogDescription>
              {editingAgreement ? "Update the service agreement details" : "Create a recurring maintenance contract"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Customer *</Label>
              <Select
                value={formData.customer_id}
                onValueChange={(value) => setFormData(prev => ({ ...prev, customer_id: value, equipment_id: "" }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select customer" />
                </SelectTrigger>
                <SelectContent>
                  <ScrollArea className="h-48">
                    {customers.map(c => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} - {c.phone}
                      </SelectItem>
                    ))}
                  </ScrollArea>
                </SelectContent>
              </Select>
            </div>

            {customerEquipment.length > 0 && (
              <div className="space-y-2">
                <Label>Equipment (Optional)</Label>
                <Select
                  value={formData.equipment_id}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, equipment_id: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All units" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All Units</SelectItem>
                    {customerEquipment.map(e => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.brand} {e.model} - {e.type} {e.location ? `(${e.location})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Contract Type *</Label>
                <Select
                  value={formData.contract_type}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, contract_type: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTRACT_TYPES.map(t => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Frequency *</Label>
                <Select
                  value={formData.frequency}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, frequency: value }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FREQUENCIES.map(f => (
                      <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {formData.contract_type === "custom" && (
              <div className="space-y-2">
                <Label>Custom Contract Name *</Label>
                <Input
                  value={formData.contract_type_custom}
                  onChange={(e) => setFormData(prev => ({ ...prev, contract_type_custom: e.target.value }))}
                  placeholder="e.g., Premium Maintenance Plan"
                />
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Date *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left font-normal">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(formData.start_date, "PPP")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={formData.start_date}
                      onSelect={(date) => date && setFormData(prev => ({ ...prev, start_date: date }))}
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="space-y-2">
                <Label>End Date *</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left font-normal">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(formData.end_date, "PPP")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={formData.end_date}
                      onSelect={(date) => date && setFormData(prev => ({ ...prev, end_date: date }))}
                      disabled={(date) => date < formData.start_date}
                      className="pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Contract Value (Total) *</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">R</span>
                <Input
                  type="number"
                  value={formData.price}
                  onChange={(e) => setFormData(prev => ({ ...prev, price: parseFloat(e.target.value) || 0 }))}
                  className="pl-8"
                  min={0}
                />
              </div>
            </div>

            <div className="flex items-center justify-between py-2">
              <div>
                <Label>Auto-Generate Jobs</Label>
                <p className="text-xs text-muted-foreground">Automatically create leads when service is due</p>
              </div>
              <Switch
                checked={formData.auto_generate_jobs}
                onCheckedChange={(checked) => setFormData(prev => ({ ...prev, auto_generate_jobs: checked }))}
              />
            </div>

            <div className="space-y-2">
              <Label>Notes (Optional)</Label>
              <Textarea
                value={formData.notes}
                onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="Special instructions, terms, etc."
                rows={3}
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { resetForm(); setShowForm(false); }} className="flex-1">
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={saving || !formData.customer_id} className="flex-1">
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingAgreement ? "Update Agreement" : "Create Agreement"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Cancel Confirmation */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Agreement?</AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel the service agreement. The customer will no longer receive scheduled maintenance.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Active</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteConfirm && handleCancel(deleteConfirm)} className="bg-red-600 hover:bg-red-700">
              Cancel Agreement
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ServiceAgreements;
