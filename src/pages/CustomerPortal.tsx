import { useEffect, useState } from "react";
import { useParams, useNavigate, Routes, Route } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Calendar, FileText, Star, Phone, Mail, Clock, CheckCircle } from "lucide-react";
import { format } from "date-fns";
import CustomerFeedbackForm from "@/components/CustomerFeedbackForm";
import CustomerInvoiceView from "@/components/CustomerInvoiceView";
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
}

const CustomerPortal = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token) {
      validateTokenAndFetchData();
    }
  }, [token]);

  const validateTokenAndFetchData = async () => {
    try {
      setLoading(true);
      
      // Validate token and get customer ID
      const { data: customerId, error: tokenError } = await supabase.rpc(
        "validate_customer_token",
        { p_token: token }
      );

      if (tokenError || !customerId) {
        setError("Invalid or expired link. Please contact us for a new link.");
        return;
      }

      // Fetch customer details
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

      // Fetch customer jobs
      const { data: jobsData } = await supabase
        .from("leads")
        .select("id, service_type, status, created_at, completed_at, customer_address")
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false })
        .limit(20);

      setJobs(jobsData || []);

    } catch (err) {
      console.error("Portal error:", err);
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

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
            <CardTitle className="text-red-600">Access Error</CardTitle>
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
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      {/* Header */}
      <header className="bg-[#0077B6] text-white p-4 shadow-md">
        <div className="max-w-2xl mx-auto flex items-center gap-4">
          <img src={logo} alt="Be Cool" className="h-12" />
          <div>
            <h1 className="font-bold text-lg">Customer Portal</h1>
            <p className="text-blue-100 text-sm">Welcome, {customer.name}</p>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-4 space-y-6">
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
            <FileText className="h-6 w-6 text-blue-500" />
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

        {/* Service History */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Service History
            </CardTitle>
            <CardDescription>Your recent appointments and jobs</CardDescription>
          </CardHeader>
          <CardContent>
            {jobs.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-4">
                No service history yet
              </p>
            ) : (
              <div className="space-y-3">
                {jobs.map((job) => (
                  <div
                    key={job.id}
                    className="flex items-start justify-between p-3 rounded-lg bg-muted/50"
                  >
                    <div className="flex-1">
                      <p className="font-medium text-sm">{job.service_type}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                        <Clock className="h-3 w-3" />
                        {format(new Date(job.created_at), "dd MMM yyyy")}
                      </div>
                    </div>
                    <Badge
                      className={
                        job.status === "completed"
                          ? "bg-green-500"
                          : job.status === "in_progress"
                          ? "bg-blue-500"
                          : "bg-gray-500"
                      }
                    >
                      {job.status === "completed" && <CheckCircle className="h-3 w-3 mr-1" />}
                      {job.status.replace("_", " ")}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Contact Footer */}
        <Card className="bg-[#0077B6]/5 border-[#0077B6]/20">
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
    </div>
  );
};

export default CustomerPortal;
