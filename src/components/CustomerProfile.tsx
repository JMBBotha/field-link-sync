import { useState, useEffect } from "react";
import { X, Loader2, User, Phone, Mail, MapPin, Calendar, FileText, Wrench, Star, Edit, ChevronRight, RefreshCw, DollarSign, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import EquipmentList from "./EquipmentList";
import InvoiceList from "./InvoiceList";
import InvoiceDetail from "./InvoiceDetail";
import { format, addYears } from "date-fns";

interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  address: string | null;
  notes: string | null;
  created_at: string;
}

interface Job {
  id: string;
  service_type: string;
  status: string;
  created_at: string;
  completed_at: string | null;
}

interface Feedback {
  id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

interface Agreement {
  id: string;
  contract_type: string;
  contract_type_custom: string | null;
  frequency: string;
  start_date: string;
  end_date: string;
  price: number;
  status: string;
  next_service_due: string | null;
}

interface CustomerProfileProps {
  customerId: string | null;
  open: boolean;
  onClose: () => void;
}

const formatDate = (dateStr: string) => {
  return new Date(dateStr).toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const getStatusBadge = (status: string) => {
  const config: Record<string, { bg: string; text: string }> = {
    pending: { bg: "bg-red-500", text: "text-white" },
    open: { bg: "bg-red-500", text: "text-white" },
    claimed: { bg: "bg-yellow-500", text: "text-black" },
    in_progress: { bg: "bg-green-500", text: "text-white" },
    completed: { bg: "bg-black", text: "text-white" },
  };
  const c = config[status] || { bg: "bg-gray-500", text: "text-white" };
  return <Badge className={`${c.bg} ${c.text} text-xs`}>{status.replace("_", " ")}</Badge>;
};

const CONTRACT_LABELS: Record<string, string> = {
  annual_ac_maintenance: "Annual AC Maintenance",
  biannual_heater_check: "Bi-Annual Heater Check",
  quarterly_filter: "Quarterly Filter Service",
  monthly_checkup: "Monthly Checkup",
  custom: "Custom",
};

const STATUS_BADGES: Record<string, { bg: string; label: string }> = {
  active: { bg: "bg-green-500", label: "Active" },
  expired: { bg: "bg-gray-500", label: "Expired" },
  cancelled: { bg: "bg-red-500", label: "Cancelled" },
  pending_renewal: { bg: "bg-orange-500", label: "Renewing Soon" },
};

const CustomerProfile = ({ customerId, open, onClose }: CustomerProfileProps) => {
  const [loading, setLoading] = useState(true);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [activeTab, setActiveTab] = useState("info");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (customerId && open) {
      fetchCustomerData();
    }
  }, [customerId, open]);

  const fetchCustomerData = async () => {
    if (!customerId) return;
    setLoading(true);

    // Fetch customer
    const { data: customerData } = await supabase
      .from("customers" as "leads")
      .select("*")
      .eq("id", customerId)
      .single();

    if (customerData) {
      setCustomer(customerData as unknown as Customer);
    }

    // Fetch jobs for this customer
    const { data: jobsData } = await supabase
      .from("leads")
      .select("id, service_type, status, created_at, completed_at")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false });

    setJobs((jobsData as Job[]) || []);

    // Fetch feedback
    const { data: feedbackData } = await supabase
      .from("customer_feedback" as "leads")
      .select("*")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false });

    setFeedback((feedbackData as unknown as Feedback[]) || []);

    // Fetch service agreements
    const { data: agreementsData } = await supabase
      .from("service_agreements")
      .select("id, contract_type, contract_type_custom, frequency, start_date, end_date, price, status, next_service_due")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false });

    setAgreements((agreementsData as Agreement[]) || []);

    setLoading(false);
  };

  const handleRenewAgreement = async (agreement: Agreement) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const newStartDate = new Date(agreement.end_date);
      const newEndDate = addYears(newStartDate, 1);
      
      const { error } = await supabase
        .from("service_agreements")
        .insert({
          customer_id: customerId,
          contract_type: agreement.contract_type,
          contract_type_custom: agreement.contract_type_custom,
          frequency: agreement.frequency,
          start_date: format(newStartDate, "yyyy-MM-dd"),
          end_date: format(newEndDate, "yyyy-MM-dd"),
          price: agreement.price,
          auto_generate_jobs: true,
          next_service_due: format(newStartDate, "yyyy-MM-dd"),
          created_by: user?.id,
        });

      if (error) throw error;
      
      toast({ title: "Agreement Renewed 🎉", description: "New contract has been created" });
      fetchCustomerData();
    } catch (error: any) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    }
  };

  const averageRating = feedback.length > 0
    ? (feedback.reduce((sum, f) => sum + f.rating, 0) / feedback.length).toFixed(1)
    : null;

  if (!open) return null;

  return (
    <>
      <Sheet open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
        <SheetContent 
          side="bottom" 
          className="h-[90vh] rounded-t-2xl border-t bg-card/95 backdrop-blur-md overflow-hidden flex flex-col"
        >
          <div className="flex justify-center pt-2 pb-1">
            <div className="w-12 h-1.5 bg-muted-foreground/30 rounded-full" />
          </div>

          <SheetHeader className="px-1 pb-2 flex-shrink-0">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-lg font-bold">Customer Profile</SheetTitle>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
                <X className="h-5 w-5" />
              </Button>
            </div>
          </SheetHeader>

          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-[#0077B6]" />
            </div>
          ) : customer ? (
            <>
              {/* Customer Header */}
              <div className="px-1 pb-3 flex-shrink-0">
                <div className="flex items-start gap-3 p-4 rounded-xl bg-background/50 border">
                  <div className="h-12 w-12 rounded-full bg-[#0077B6]/20 flex items-center justify-center">
                    <User className="h-6 w-6 text-[#0077B6]" />
                  </div>
                  <div className="flex-1">
                    <h2 className="text-lg font-bold">{customer.name}</h2>
                    <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                      <span>{jobs.length} jobs</span>
                      {averageRating && (
                        <span className="flex items-center gap-1">
                          <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
                          {averageRating}
                        </span>
                      )}
                    </div>
                  </div>
                  <Button variant="outline" size="icon" className="h-8 w-8">
                    <Edit className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Tabs */}
              <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0 px-1">
                <TabsList className="grid w-full grid-cols-6 flex-shrink-0">
                  <TabsTrigger value="info" className="text-xs px-1">Info</TabsTrigger>
                  <TabsTrigger value="equipment" className="text-xs px-1">Equip</TabsTrigger>
                  <TabsTrigger value="agreements" className="text-xs px-1">Contracts</TabsTrigger>
                  <TabsTrigger value="jobs" className="text-xs px-1">Jobs</TabsTrigger>
                  <TabsTrigger value="invoices" className="text-xs px-1">Invoices</TabsTrigger>
                  <TabsTrigger value="feedback" className="text-xs px-1">Rating</TabsTrigger>
                </TabsList>

                {/* Info Tab */}
                <TabsContent value="info" className="flex-1 overflow-y-auto mt-3 space-y-3">
                  <div className="space-y-3">
                    <a
                      href={`tel:${customer.phone}`}
                      className="flex items-center gap-3 p-3 rounded-xl bg-background/50 hover:bg-background/80 transition-colors"
                    >
                      <div className="h-10 w-10 rounded-full bg-[#0077B6]/20 flex items-center justify-center">
                        <Phone className="h-5 w-5 text-[#0077B6]" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{customer.phone}</p>
                        <p className="text-xs text-muted-foreground">Tap to call</p>
                      </div>
                    </a>

                    {customer.email && (
                      <a
                        href={`mailto:${customer.email}`}
                        className="flex items-center gap-3 p-3 rounded-xl bg-background/50 hover:bg-background/80 transition-colors"
                      >
                        <div className="h-10 w-10 rounded-full bg-[#0077B6]/20 flex items-center justify-center">
                          <Mail className="h-5 w-5 text-[#0077B6]" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">{customer.email}</p>
                          <p className="text-xs text-muted-foreground">Tap to email</p>
                        </div>
                      </a>
                    )}

                    {customer.address && (
                      <div className="flex items-start gap-3 p-3 rounded-xl bg-background/50">
                        <div className="h-10 w-10 rounded-full bg-[#0077B6]/20 flex items-center justify-center">
                          <MapPin className="h-5 w-5 text-[#0077B6]" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">{customer.address}</p>
                          <p className="text-xs text-muted-foreground">Address</p>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-3 p-3 rounded-xl bg-background/50">
                      <div className="h-10 w-10 rounded-full bg-[#0077B6]/20 flex items-center justify-center">
                        <Calendar className="h-5 w-5 text-[#0077B6]" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{formatDate(customer.created_at)}</p>
                        <p className="text-xs text-muted-foreground">Customer since</p>
                      </div>
                    </div>

                    {customer.notes && (
                      <div className="p-3 rounded-xl bg-background/50">
                        <p className="text-xs text-muted-foreground mb-1">Notes</p>
                        <p className="text-sm">{customer.notes}</p>
                      </div>
                    )}
                  </div>
                </TabsContent>

                {/* Equipment Tab */}
                <TabsContent value="equipment" className="flex-1 overflow-y-auto mt-3">
                  <EquipmentList customerId={customer.id} />
                </TabsContent>

                {/* Agreements Tab */}
                <TabsContent value="agreements" className="flex-1 overflow-y-auto mt-3">
                  {agreements.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>No service agreements</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {agreements.map((agreement) => {
                        const statusInfo = STATUS_BADGES[agreement.status] || STATUS_BADGES.active;
                        const contractLabel = agreement.contract_type === "custom" && agreement.contract_type_custom
                          ? agreement.contract_type_custom
                          : CONTRACT_LABELS[agreement.contract_type] || agreement.contract_type;
                        return (
                          <Card key={agreement.id} className="hover:bg-accent/50 transition-colors">
                            <CardContent className="p-3">
                              <div className="flex items-start justify-between mb-2">
                                <div>
                                  <p className="font-medium text-sm">{contractLabel}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {format(new Date(agreement.start_date), "dd MMM yyyy")} - {format(new Date(agreement.end_date), "dd MMM yyyy")}
                                  </p>
                                </div>
                                <Badge className={`${statusInfo.bg} text-white text-xs`}>{statusInfo.label}</Badge>
                              </div>
                              <div className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-2">
                                  <DollarSign className="h-3 w-3 text-green-600" />
                                  <span className="font-medium">R {Number(agreement.price).toLocaleString()}</span>
                                </div>
                                {agreement.next_service_due && (
                                  <div className="flex items-center gap-1 text-muted-foreground">
                                    <Clock className="h-3 w-3" />
                                    <span>Next: {format(new Date(agreement.next_service_due), "dd MMM")}</span>
                                  </div>
                                )}
                              </div>
                              {(agreement.status === "expired" || agreement.status === "pending_renewal") && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="w-full mt-2 text-xs h-7"
                                  onClick={() => handleRenewAgreement(agreement)}
                                >
                                  <RefreshCw className="h-3 w-3 mr-1" />
                                  Renew Agreement
                                </Button>
                              )}
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </TabsContent>

                {/* Jobs Tab */}
                <TabsContent value="jobs" className="flex-1 overflow-y-auto mt-3">
                  {jobs.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>No jobs recorded</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {jobs.map((job) => (
                        <Card key={job.id} className="hover:bg-accent/50 transition-colors">
                          <CardContent className="p-3">
                            <div className="flex items-center justify-between">
                              <div>
                                <p className="font-medium text-sm">{job.service_type}</p>
                                <p className="text-xs text-muted-foreground">
                                  {formatDate(job.created_at)}
                                  {job.completed_at && ` → ${formatDate(job.completed_at)}`}
                                </p>
                              </div>
                              {getStatusBadge(job.status)}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </TabsContent>

                {/* Invoices Tab */}
                <TabsContent value="invoices" className="flex-1 overflow-y-auto mt-3">
                  <InvoiceList
                    onSelectInvoice={(inv) => setSelectedInvoiceId(inv.id)}
                  />
                </TabsContent>

                {/* Feedback Tab */}
                <TabsContent value="feedback" className="flex-1 overflow-y-auto mt-3">
                  {feedback.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      <Star className="h-8 w-8 mx-auto mb-2 opacity-50" />
                      <p>No feedback yet</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {feedback.map((fb) => (
                        <Card key={fb.id}>
                          <CardContent className="p-3">
                            <div className="flex items-center gap-1 mb-2">
                              {[1, 2, 3, 4, 5].map((star) => (
                                <Star
                                  key={star}
                                  className={`h-4 w-4 ${
                                    star <= fb.rating
                                      ? "fill-yellow-400 text-yellow-400"
                                      : "text-gray-300"
                                  }`}
                                />
                              ))}
                              <span className="ml-2 text-xs text-muted-foreground">
                                {formatDate(fb.created_at)}
                              </span>
                            </div>
                            {fb.comment && (
                              <p className="text-sm">{fb.comment}</p>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              Customer not found
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Invoice Detail */}
      <InvoiceDetail
        invoiceId={selectedInvoiceId}
        open={!!selectedInvoiceId}
        onClose={() => setSelectedInvoiceId(null)}
      />
    </>
  );
};

export default CustomerProfile;