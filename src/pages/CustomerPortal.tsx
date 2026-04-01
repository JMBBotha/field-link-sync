import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Calendar, FileText, Star, Phone, Mail, Clock, CheckCircle, Wrench, Plus } from "lucide-react";
import { format } from "date-fns";
import CustomerFeedbackForm from "@/components/CustomerFeedbackForm";
import CustomerInvoiceView from "@/components/CustomerInvoiceView";
import { useToast } from "@/hooks/use-toast";
import logo from "@/assets/logo.png";

interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  address: string | null;
}

interface Job {
  id: string;
  service_type: string;
  status: string;
  created_at: string;
  completed_at: string | null;
  customer_address: string;
  assigned_agent_id: string | null;
}

interface MaintenanceDue {
  id: string;
  due_date: string;
  status: string;
  contract_type: string;
  equipment_brand: string | null;
  equipment_model: string | null;
}

interface Invoice {
  id: string;
  invoice_number: string;
  lead_id: string | null;
  status: string;
  grand_total: number;
}

const STATUS_CONFIG: Record<string, { color: string; dotColor: string; label: string }> = {
  completed: { color: "bg-green-500/10 text-green-600 dark:text-green-400", dotColor: "bg-green-500", label: "Completed" },
  on_site: { color: "bg-blue-500/10 text-blue-600 dark:text-blue-400", dotColor: "bg-blue-500", label: "On Site" },
  en_route: { color: "bg-amber-500/10 text-amber-600 dark:text-amber-400", dotColor: "bg-amber-500", label: "En Route" },
  accepted: { color: "bg-primary/10 text-primary", dotColor: "bg-primary", label: "Accepted" },
  pending: { color: "bg-muted text-muted-foreground", dotColor: "bg-muted-foreground", label: "Pending" },
};

const CustomerPortal = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [agentNames, setAgentNames] = useState<Record<string, string>>({});
  const [upcomingMaintenance, setUpcomingMaintenance] = useState<MaintenanceDue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingSubmitting, setBookingSubmitting] = useState(false);
  const [bookingForm, setBookingForm] = useState({
    service_type: "maintenance",
    preferred_date: "",
    notes: "",
  });

  useEffect(() => {
    if (token) {
      validateTokenAndFetchData();
    }
  }, [token]);

  const validateTokenAndFetchData = async () => {
    try {
      setLoading(true);

      const { data: customerId, error: tokenError } = await supabase.rpc(
        "validate_customer_token",
        { p_token: token }
      );

      if (tokenError || !customerId) {
        setError("Invalid or expired link. Please contact us for a new link.");
        return;
      }

      const { data: customerData, error: customerError } = await supabase
        .from("customers")
        .select("id, name, email, phone, address")
        .eq("id", customerId)
        .single();

      if (customerError || !customerData) {
        setError("Unable to load your information.");
        return;
      }

      setCustomer(customerData);

      // Fetch jobs, invoices, maintenance in parallel
      const [jobsRes, invoicesRes, maintenanceRes] = await Promise.all([
        supabase
          .from("leads")
          .select("id, service_type, status, created_at, completed_at, customer_address, assigned_agent_id")
          .eq("customer_id", customerId)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("invoices")
          .select("id, invoice_number, lead_id, status, grand_total")
          .eq("customer_id", customerId),
        supabase
          .from("maintenance_schedules")
          .select(`
            id, due_date, status,
            service_agreements:agreement_id (contract_type),
            equipment:equipment_id (brand, model)
          `)
          .eq("customer_id", customerId)
          .in("status", ["upcoming", "scheduled"])
          .gte("due_date", new Date().toISOString().split("T")[0])
          .order("due_date", { ascending: true })
          .limit(5),
      ]);

      const jobsData = jobsRes.data || [];
      setJobs(jobsData);
      setInvoices(invoicesRes.data || []);

      // Fetch agent names for assigned jobs
      const agentIds = [...new Set(jobsData.map((j) => j.assigned_agent_id).filter(Boolean))] as string[];
      if (agentIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name")
          .in("id", agentIds);
        const names: Record<string, string> = {};
        (profiles || []).forEach((p) => { names[p.id] = p.full_name; });
        setAgentNames(names);
      }

      setUpcomingMaintenance(
        (maintenanceRes.data || []).map((m: any) => ({
          id: m.id,
          due_date: m.due_date,
          status: m.status,
          contract_type: m.service_agreements?.contract_type || "Maintenance",
          equipment_brand: m.equipment?.brand || null,
          equipment_model: m.equipment?.model || null,
        }))
      );
    } catch (err) {
      console.error("Portal error:", err);
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleBookingSubmit = async () => {
    if (!customer) return;
    setBookingSubmitting(true);
    try {
      const { error: insertError } = await supabase.rpc("create_portal_booking", {
        p_token: token as string,
        p_service_type: bookingForm.service_type,
        p_notes: `[Customer Portal Booking] ${bookingForm.preferred_date ? `Preferred date: ${bookingForm.preferred_date}. ` : ""}${bookingForm.notes}`,
      });
      if (insertError) throw insertError;
      toast({ title: "✅ Booking Submitted", description: "We'll be in touch to confirm your appointment." });
      setBookingOpen(false);
      setBookingForm({ service_type: "maintenance", preferred_date: "", notes: "" });
      validateTokenAndFetchData();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setBookingSubmitting(false);
    }
  };

  const invoiceMap = new Map(invoices.map((inv) => [inv.lead_id, inv]));

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary mb-4" />
          <p className="text-muted-foreground">Loading your portal...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardHeader className="text-center">
            <img src={logo} alt="Be Cool" className="h-16 mx-auto mb-4" />
            <CardTitle className="text-destructive">Access Error</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button onClick={() => window.location.href = "tel:+27000000000"}>
              <Phone className="h-4 w-4 mr-2" />
              Contact Us
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!customer) return null;

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white dark:from-[#070e1a] dark:to-[#0a1628] animate-fade-in">
      {/* Header */}
      <header className="bg-primary text-primary-foreground p-4 shadow-md">
        <div className="max-w-2xl mx-auto flex items-center gap-4">
          <img src={logo} alt="Be Cool" className="h-12" />
          <div>
            <h1 className="font-bold text-lg">Customer Portal</h1>
            <p className="text-primary-foreground/70 text-sm">Welcome, {customer.name}</p>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-4 space-y-6">
        {/* Book Maintenance CTA */}
        <Button
          onClick={() => setBookingOpen(true)}
          className="w-full bg-gradient-to-r from-primary to-blue-400 hover:from-blue-500 hover:to-blue-300 text-primary-foreground font-semibold py-6 px-6 rounded-xl shadow-lg transition-all duration-300 transform hover:scale-[1.02] text-base"
        >
          <Plus className="h-5 w-5 mr-2" />
          Book Maintenance
        </Button>

        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-3">
          <Button
            variant="outline"
            className="h-auto py-4 flex flex-col items-center gap-2"
            onClick={() => navigate(`/customer/${token}/feedback`)}
          >
            <Star className="h-6 w-6 text-yellow-500" />
            <span>Give Feedback</span>
          </Button>
          <Button
            variant="outline"
            className="h-auto py-4 flex flex-col items-center gap-2"
            onClick={() => navigate(`/customer/${token}/invoices`)}
          >
            <FileText className="h-6 w-6 text-primary" />
            <span>View Invoices</span>
          </Button>
        </div>

        {/* Contact Info */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Your Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <span>{customer.phone}</span>
            </div>
            {customer.email && (
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span>{customer.email}</span>
              </div>
            )}
            {customer.address && (
              <p className="text-muted-foreground">{customer.address}</p>
            )}
          </CardContent>
        </Card>

        {/* Service History Timeline */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Service History
            </CardTitle>
            <CardDescription>Your service timeline</CardDescription>
          </CardHeader>
          <CardContent>
            {jobs.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-4">
                No service history yet
              </p>
            ) : (
              <div className="relative pl-8">
                {/* Vertical timeline line */}
                <div className="absolute left-[15px] top-2 bottom-2 w-0.5 bg-primary/30" />

                <div className="space-y-4">
                  {jobs.map((job, index) => {
                    const statusConf = STATUS_CONFIG[job.status] || STATUS_CONFIG.pending;
                    const inv = invoiceMap.get(job.id);
                    const techName = job.assigned_agent_id ? agentNames[job.assigned_agent_id] : null;

                    return (
                      <div key={job.id} className="relative">
                        {/* Timeline dot */}
                        <div className={`absolute -left-8 top-3 w-4 h-4 rounded-full border-2 border-background ${statusConf.dotColor} z-10`} />

                        {/* Timeline card */}
                        <div className="rounded-lg border border-border p-4 transition-colors hover:bg-muted/30 dark:bg-card/80 dark:border-primary/20 dark:hover:bg-primary/5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm">{job.service_type}</p>
                              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                                <Clock className="h-3 w-3 shrink-0" />
                                {format(new Date(job.created_at), "dd MMM yyyy")}
                                {job.completed_at && (
                                  <span className="flex items-center gap-1">
                                    <CheckCircle className="h-3 w-3 text-green-500" />
                                    {format(new Date(job.completed_at), "dd MMM")}
                                  </span>
                                )}
                              </div>
                              {techName && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  Technician: {techName}
                                </p>
                              )}
                            </div>

                            <div className="flex flex-col items-end gap-1.5 shrink-0">
                              <Badge variant="secondary" className={`text-xs ${statusConf.color}`}>
                                {statusConf.label}
                              </Badge>
                              {inv && (
                                <button
                                  onClick={() => navigate(`/customer/${token}/invoices`)}
                                  className="flex items-center gap-1 text-xs text-primary hover:underline font-medium"
                                >
                                  <FileText className="h-3 w-3" />
                                  {inv.invoice_number}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Upcoming Maintenance */}
        {upcomingMaintenance.length > 0 && (
          <Card className="border-primary/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Wrench className="h-4 w-4 text-primary" />
                Upcoming Maintenance
              </CardTitle>
              <CardDescription>Your scheduled preventive maintenance</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {upcomingMaintenance.map((m) => (
                  <div key={m.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <div>
                      <p className="font-medium text-sm">
                        {m.contract_type.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}
                      </p>
                      {(m.equipment_brand || m.equipment_model) && (
                        <p className="text-xs text-muted-foreground">{m.equipment_brand} {m.equipment_model}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">{format(new Date(m.due_date), "dd MMM yyyy")}</p>
                      <Badge variant="outline" className="text-xs mt-1">{m.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Contact Footer */}
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="py-4">
            <p className="text-sm text-center text-muted-foreground mb-3">
              Need help? Contact us anytime
            </p>
            <div className="flex justify-center gap-3">
              <Button size="sm" variant="outline" asChild>
                <a href="tel:+27000000000">
                  <Phone className="h-4 w-4 mr-2" />
                  Call
                </a>
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a href="https://wa.me/27000000000" target="_blank" rel="noopener noreferrer">
                  💬 WhatsApp
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Book Maintenance Dialog */}
      <Dialog open={bookingOpen} onOpenChange={setBookingOpen}>
        <DialogContent className="bg-background/95 backdrop-blur-md dark:bg-[#070e1a]/95 dark:border-primary/20">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wrench className="h-5 w-5 text-primary" />
              Book Maintenance
            </DialogTitle>
            <DialogDescription>
              Request a service appointment. We'll contact you to confirm.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Pre-filled customer info */}
            <div className="rounded-lg bg-muted/50 p-3 text-sm space-y-1">
              <p className="font-medium">{customer.name}</p>
              <p className="text-muted-foreground">{customer.phone}</p>
              {customer.address && <p className="text-muted-foreground">{customer.address}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="service_type">Service Type</Label>
              <Select
                value={bookingForm.service_type}
                onValueChange={(v) => setBookingForm((prev) => ({ ...prev, service_type: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="maintenance">General Maintenance</SelectItem>
                  <SelectItem value="repair">Repair</SelectItem>
                  <SelectItem value="installation">Installation</SelectItem>
                  <SelectItem value="inspection">Inspection</SelectItem>
                  <SelectItem value="filter_clean">Filter Clean</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="preferred_date">Preferred Date</Label>
              <Input
                id="preferred_date"
                type="date"
                value={bookingForm.preferred_date}
                onChange={(e) => setBookingForm((prev) => ({ ...prev, preferred_date: e.target.value }))}
                min={new Date().toISOString().split("T")[0]}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Additional Notes</Label>
              <Textarea
                id="notes"
                placeholder="Describe the issue or any special requirements..."
                value={bookingForm.notes}
                onChange={(e) => setBookingForm((prev) => ({ ...prev, notes: e.target.value }))}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setBookingOpen(false)}>Cancel</Button>
            <Button onClick={handleBookingSubmit} disabled={bookingSubmitting}>
              {bookingSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Submit Booking
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CustomerPortal;
