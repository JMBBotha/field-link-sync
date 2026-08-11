import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import CallHistoryPanel from "@/components/calls/CallHistoryPanel";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format, subMonths, startOfMonth } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { DetailPageSkeleton } from "@/components/ui/skeletons";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  ArrowLeft, Mail, Phone, MapPin, FileText, Settings2, Plus, ChevronDown, Loader2,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { cn } from "@/lib/utils";
import { formatRand } from "@/utils/formatRand";
import CustomerLocationsManager from "@/components/customers/CustomerLocationsManager";
import QuickTemplateDialog from "@/components/quoting/QuickTemplateDialog";
import EntityDetailsForm from "@/components/entity/EntityDetailsForm";

import { LEAD_SOURCE_OPTIONS, DEFAULT_LEAD_SOURCE, toLeadSourceValue, leadSourceLabel } from "@/lib/leadSources";

const LEAD_SOURCE_STYLES: Record<string, string> = {
  manual:        "bg-slate-100 text-slate-700 border-slate-200",
  facebook_lead: "bg-blue-100 text-blue-700 border-blue-200",
  website_form:  "bg-green-100 text-green-700 border-green-200",
  website:       "bg-green-100 text-green-700 border-green-200",
  whatsapp:      "bg-emerald-100 text-emerald-700 border-emerald-200",
  phone_call:    "bg-orange-100 text-orange-700 border-orange-200",
  vapi:          "bg-orange-100 text-orange-700 border-orange-200",
  walk_in:       "bg-purple-100 text-purple-700 border-purple-200",
  referral:      "bg-pink-100 text-pink-700 border-pink-200",
  other:         "bg-slate-100 text-slate-700 border-slate-200",
};

const statusBadge = (status?: string | null) => {
  const s = (status || "").toLowerCase();
  if (s === "paid" || s === "accepted" || s === "completed" || s === "active") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (s === "overdue" || s === "declined") return "bg-rose-100 text-rose-700 border-rose-200";
  if (s === "draft") return "bg-slate-100 text-slate-700 border-slate-200";
  if (s === "sent" || s === "viewed" || s === "scheduled" || s === "in_progress") return "bg-blue-100 text-blue-700 border-blue-200";
  return "bg-amber-100 text-amber-700 border-amber-200";
};

const getInitials = (first?: string | null, last?: string | null, company?: string | null) => {
  const src = company || `${first || ""} ${last || ""}`.trim();
  return src.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join("") || "?";
};

const AdminCustomerDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  const { data: customer, isLoading } = useQuery({
    queryKey: ["customer-detail", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: invoices = [] } = useQuery({
    queryKey: ["customer-invoices", id, customer?.name],
    enabled: !!id,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const orParts = [`customer_id.eq.${id}`];
      if (customer?.name) orParts.push(`customer_name.ilike.${customer.name}`);
      const { data, error } = await supabase
        .from("invoices")
        .select("id, invoice_number, notes, issue_date, due_date, grand_total, status, created_at, customer_id, customer_name")
        .or(orParts.join(","))
        .order("created_at", { ascending: false });
      if (error) throw error;
      const seen = new Set<string>();
      return (data || []).filter((r: any) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
    },
  });

  const { data: quotes = [] } = useQuery({
    queryKey: ["customer-quotes", id, customer?.name],
    enabled: !!id,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const orParts = [`customer_id.eq.${id}`];
      if (customer?.name) orParts.push(`customer_name.ilike.${customer.name}`);
      const { data, error } = await supabase
        .from("quotes")
        .select("id, quote_number, notes, total, status, created_at, customer_id, customer_name")
        .or(orParts.join(","))
        .neq("status", "superseded")
        .order("created_at", { ascending: false });

      if (error) throw error;
      const seen = new Set<string>();
      return (data || []).filter((r: any) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
    },
  });

  const { data: jobs = [] } = useQuery({
    queryKey: ["customer-jobs-detail", id],
    enabled: !!id,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const { data, error } = await supabase
        .from("jobs")
        .select("id, title, description, status, scheduled_for, created_at")
        .eq("customer_id", id!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  // Realtime auto-sync — Lead → Quote → Job → Invoice.
  // Any insert/update/delete on the related tables invalidates this customer's
  // tab data so the latest records + statuses appear without a manual refresh.
  useEffect(() => {
    if (!id) return;
    const filter = `customer_id=eq.${id}`;
    const channel = supabase
      .channel(`customer-sync-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "quotes", filter }, () => {
        qc.invalidateQueries({ queryKey: ["customer-quotes", id] });
        qc.invalidateQueries({ queryKey: ["customer-detail", id] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs", filter }, () => {
        qc.invalidateQueries({ queryKey: ["customer-jobs-detail", id] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices", filter }, () => {
        qc.invalidateQueries({ queryKey: ["customer-invoices", id] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "leads", filter }, () => {
        // Lead status changes (e.g. lead converted) can affect the customer summary.
        qc.invalidateQueries({ queryKey: ["customer-detail", id] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [id, qc]);

  // 6-month revenue chart
  const chartData = useMemo(() => {
    const buckets: { month: string; key: string; amount: number }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = startOfMonth(subMonths(now, i));
      buckets.push({ month: format(d, "MMM"), key: format(d, "yyyy-MM"), amount: 0 });
    }
    for (const inv of invoices) {
      const date = inv.issue_date || inv.created_at;
      if (!date) continue;
      const key = format(new Date(date), "yyyy-MM");
      const bucket = buckets.find(b => b.key === key);
      if (bucket) bucket.amount += Number(inv.grand_total || 0);
    }
    return buckets;
  }, [invoices]);

  const draftQuotesTotal = useMemo(
    () => quotes.filter(q => q.status === "draft").reduce((s, q) => s + Number(q.total || 0), 0),
    [quotes],
  );

  // ---------- Status summaries for each section ----------
  const quoteSummary = useMemo(() => {
    const s = { draft: 0, sent: 0, accepted: 0, declined: 0, openValue: 0, acceptedValue: 0 };
    for (const q of quotes as any[]) {
      const st = (q.status || "draft").toLowerCase();
      const total = Number(q.total || 0);
      if (st === "draft") s.draft++;
      else if (st === "sent" || st === "viewed" || st === "pending") s.sent++;
      else if (st === "accepted") { s.accepted++; s.acceptedValue += total; }
      else if (st === "declined") s.declined++;
      if (["draft", "sent", "viewed", "pending"].includes(st)) s.openValue += total;
    }
    return s;
  }, [quotes]);

  const jobSummary = useMemo(() => {
    const s = { scheduled: 0, inProgress: 0, completed: 0, other: 0 };
    for (const j of jobs as any[]) {
      const st = (j.status || "").toLowerCase();
      if (st === "scheduled" || st === "pending") s.scheduled++;
      else if (st === "in_progress" || st === "in progress" || st === "active") s.inProgress++;
      else if (st === "completed" || st === "done") s.completed++;
      else s.other++;
    }
    return s;
  }, [jobs]);

  const invoiceSummary = useMemo(() => {
    const s = { draft: 0, sent: 0, paid: 0, overdue: 0, outstanding: 0, paidValue: 0 };
    const now = new Date();
    for (const inv of invoices as any[]) {
      const st = (inv.status || "draft").toLowerCase();
      const total = Number(inv.grand_total || 0);
      const overdue = st !== "paid" && inv.due_date && new Date(inv.due_date) < now;
      if (st === "paid") { s.paid++; s.paidValue += total; }
      else if (overdue) { s.overdue++; s.outstanding += total; }
      else if (st === "sent" || st === "viewed") { s.sent++; s.outstanding += total; }
      else if (st === "draft") s.draft++;
      else s.outstanding += total;
    }
    return s;
  }, [invoices]);

  if (isLoading) {
    return <DetailPageSkeleton />;
  }

  if (!customer) {
    return (
      <div className="p-8 text-center">
        <p className="text-muted-foreground">Customer not found.</p>
        <Button variant="outline" onClick={() => navigate("/admin/customers")} className="mt-4">
          Back to Clients
        </Button>
      </div>
    );
  }

  const fullName = `${customer.first_name || ""} ${customer.last_name || ""}`.trim();
  const headerName =
    customer.is_company && customer.company_name
      ? customer.company_name
      : fullName || customer.name || "Unnamed";
  const contactName = customer.is_company ? fullName : headerName;
  const structuredAddress = [customer.primary_address_line1, customer.primary_address_line2, customer.city, customer.postal_code]
    .filter(Boolean).join(", ");
  // Fall back to the free-text address (what phone/WhatsApp intake writes) so the
  // profile card is never blank when an address is actually on file.
  const fullAddress = structuredAddress || (customer.address || "").trim();

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      {/* Breadcrumb */}
      <Link
        to="/admin/customers"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="h-4 w-4" /> Clients
      </Link>

      {/* Header row */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold">{headerName}</h1>
          <Badge variant="outline" className={cn("text-[10px]", LEAD_SOURCE_STYLES[toLeadSourceValue(customer.lead_source)])}>
            {leadSourceLabel(customer.lead_source)}
          </Badge>
        </div>
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">More Actions <ChevronDown className="h-4 w-4 ml-1" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => toast({ title: "Email feature coming soon" })}>
                Send Email
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate(`/admin/customers`)}>Back to list</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="bg-emerald-600 hover:bg-emerald-700 text-white">
                <Plus className="h-4 w-4 mr-1" /> Create New <ChevronDown className="h-4 w-4 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setShowTemplatePicker(true)}>
                Quote from Template
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate(`/admin/quotes?customerId=${id}`)}>New Blank Quote</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/admin/invoices")}>New Invoice</DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate("/admin/jobs")}>New Job</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="calls">Calls</TabsTrigger>
          <TabsTrigger value="locations">Locations</TabsTrigger>
          <TabsTrigger value="relationship">Relationship</TabsTrigger>
        </TabsList>

        <TabsContent value="calls" className="mt-4">
          <CallHistoryPanel customerId={id} title="Voice assistant calls" />
        </TabsContent>


        <TabsContent value="overview" className="mt-4 space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Contact card */}
            <Card className="lg:col-span-1 bg-card">
              <CardContent className="p-6 space-y-4">
                <div className="flex flex-col items-center text-center gap-3">
                  <Avatar className="h-20 w-20">
                    <AvatarFallback className="bg-[#0066CC] text-white text-xl font-bold">
                      {getInitials(customer.first_name, customer.last_name, customer.company_name)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-bold text-base">{contactName || headerName}</p>
                    {customer.is_company && fullName && (
                      <p className="text-xs text-muted-foreground">Primary contact</p>
                    )}
                  </div>
                </div>
                {/* Always render every core field so it is immediately clear
                    what is on file and what is still missing. */}
                <EntityDetailsForm
                  entityType="client"
                  entityId={customer.id}
                  initialData={customer as any}
                  visibleFields={[
                    "name",
                    "company_name",
                    "phone",
                    "secondary_phone",
                    "email",
                    "primary_address_line1",
                    "city",
                    "postal_code",
                    "vat_number",
                    "status",
                    "notes",
                  ]}
                  className="grid-cols-1"
                />

              </CardContent>
            </Card>

            {/* Revenue chart + stats */}
            <Card className="lg:col-span-2 bg-card">
              <CardContent className="p-6 space-y-4">
                <div>
                  <p className="text-sm font-semibold">Outstanding Revenue</p>
                  <p className="text-xs text-muted-foreground">Last 6 months</p>
                </div>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip
                        contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                        formatter={(v: number) => formatRand(v)}
                      />
                      <Bar dataKey="amount" fill="#0066CC" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="grid grid-cols-3 gap-3 pt-2 border-t">
                  <Stat label="In Draft" value={formatRand(draftQuotesTotal)} />
                  <Stat label="Unbilled Time" value="0h" />
                  <Stat label="Unbilled Expenses" value="R 0,00" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Bottom tabs */}
          <Card className="bg-card">
            <CardContent className="p-0">
              <Tabs defaultValue="quotes">
                <div className="border-b overflow-x-auto">
                  <TabsList className="m-3 md:m-4 flex-nowrap w-max">
                    <TabsTrigger value="invoices">
                      Invoices {invoices.length > 0 && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-muted">{invoices.length}</span>}
                    </TabsTrigger>
                    <TabsTrigger value="quotes">
                      Quotes {quotes.length > 0 && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-muted">{quotes.length}</span>}
                    </TabsTrigger>
                    <TabsTrigger value="jobs">
                      Jobs {jobs.length > 0 && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-muted">{jobs.length}</span>}
                    </TabsTrigger>
                    <TabsTrigger value="contacts">Contacts</TabsTrigger>
                    <TabsTrigger value="credits">Credits</TabsTrigger>
                    <TabsTrigger value="estimates">Estimates</TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="invoices" className="p-0 mt-0">
                  <SectionHeader title="Invoices" onNew={() => navigate("/admin/invoices")} cta="+ New Invoice" />
                  <SummaryChips
                    items={[
                      { label: "Outstanding", value: formatRand(invoiceSummary.outstanding), tone: invoiceSummary.outstanding > 0 ? "amber" : "slate" },
                      { label: "Overdue", value: String(invoiceSummary.overdue), tone: invoiceSummary.overdue > 0 ? "rose" : "slate" },
                      { label: "Paid", value: `${invoiceSummary.paid} · ${formatRand(invoiceSummary.paidValue)}`, tone: "emerald" },
                      { label: "Draft", value: String(invoiceSummary.draft), tone: "slate" },
                    ]}
                  />
                  <div className="max-h-[560px] overflow-auto px-2 md:px-4 pb-6">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Invoice #</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead>Issued</TableHead>
                          <TableHead>Due</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {invoices.map((inv: any) => (
                          <TableRow key={inv.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/admin/invoices/${inv.id}`)}>
                            <TableCell className="font-medium">{inv.invoice_number || "—"}</TableCell>
                            <TableCell className="max-w-[260px] truncate text-muted-foreground text-xs">{inv.notes || "—"}</TableCell>
                            <TableCell className="text-xs">{inv.issue_date ? format(new Date(inv.issue_date), "dd MMM yyyy") : "—"}</TableCell>
                            <TableCell className="text-xs">{inv.due_date ? format(new Date(inv.due_date), "dd MMM yyyy") : "—"}</TableCell>
                            <TableCell className="text-right font-medium">{formatRand(Number(inv.grand_total || 0))}</TableCell>
                            <TableCell><Badge variant="outline" className={cn("text-[10px]", statusBadge(inv.status))}>{inv.status || "draft"}</Badge></TableCell>
                          </TableRow>
                        ))}
                        {invoices.length === 0 && <EmptyRow cols={6} text="No invoices yet." />}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                <TabsContent value="quotes" className="p-0 mt-0">
                  <SectionHeader title="Quotes" onNew={() => setShowTemplatePicker(true)} cta="+ Quote from Template" />
                  <SummaryChips
                    items={[
                      { label: "Open value", value: formatRand(quoteSummary.openValue), tone: quoteSummary.openValue > 0 ? "blue" : "slate" },
                      { label: "Sent", value: String(quoteSummary.sent), tone: "blue" },
                      { label: "Accepted", value: `${quoteSummary.accepted} · ${formatRand(quoteSummary.acceptedValue)}`, tone: "emerald" },
                      { label: "Draft", value: String(quoteSummary.draft), tone: "slate" },
                      { label: "Declined", value: String(quoteSummary.declined), tone: quoteSummary.declined > 0 ? "rose" : "slate" },
                    ]}
                  />
                  <div className="max-h-[560px] overflow-auto px-2 md:px-4 pb-6">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Quote #</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {quotes.map((q: any) => (
                          <TableRow key={q.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/admin/quotes/${q.id}`)}>
                            <TableCell className="font-medium">{q.quote_number || "—"}</TableCell>
                            <TableCell className="max-w-[260px] truncate text-muted-foreground text-xs">{q.notes || "—"}</TableCell>
                            <TableCell className="text-xs">{q.created_at ? format(new Date(q.created_at), "dd MMM yyyy") : "—"}</TableCell>
                            <TableCell className="text-right font-medium">{formatRand(Number(q.total || 0))}</TableCell>
                            <TableCell><Badge variant="outline" className={cn("text-[10px]", statusBadge(q.status))}>{q.status || "draft"}</Badge></TableCell>
                          </TableRow>
                        ))}
                        {quotes.length === 0 && <EmptyRow cols={5} text="No quotes yet." />}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                <TabsContent value="jobs" className="p-0 mt-0">
                  <SectionHeader title="Jobs" onNew={() => navigate("/admin/jobs")} cta="+ New Job" />
                  <SummaryChips
                    items={[
                      { label: "Scheduled", value: String(jobSummary.scheduled), tone: "blue" },
                      { label: "In progress", value: String(jobSummary.inProgress), tone: jobSummary.inProgress > 0 ? "amber" : "slate" },
                      { label: "Completed", value: String(jobSummary.completed), tone: "emerald" },
                      { label: "Other", value: String(jobSummary.other), tone: "slate" },
                    ]}
                  />
                  <div className="max-h-[560px] overflow-auto px-2 md:px-4 pb-6">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Job</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {jobs.map((j: any) => (
                          <TableRow key={j.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/admin/jobs/${j.id}`)}>
                            <TableCell className="font-medium">{j.title || "Untitled"}</TableCell>
                            <TableCell className="max-w-[260px] truncate text-muted-foreground text-xs">{j.description || "—"}</TableCell>
                            <TableCell className="text-xs">{(j.scheduled_for || j.created_at) ? format(new Date((j.scheduled_for || j.created_at)!), "dd MMM yyyy") : "—"}</TableCell>
                            <TableCell><Badge variant="outline" className={cn("text-[10px]", statusBadge(j.status))}>{j.status || "pending"}</Badge></TableCell>
                          </TableRow>
                        ))}
                        {jobs.length === 0 && <EmptyRow cols={4} text="No jobs yet." />}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                <TabsContent value="contacts" className="p-6 text-sm text-muted-foreground">
                  Additional contacts will appear here.
                </TabsContent>
                <TabsContent value="credits" className="p-6 text-sm text-muted-foreground">
                  No credits on file.
                </TabsContent>
                <TabsContent value="estimates" className="p-6 text-sm text-muted-foreground">
                  Estimates will appear here.
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="locations" className="mt-4">
          <Card className="bg-card">
            <CardContent className="p-6">
              {customer.company_id ? (
                <CustomerLocationsManager customerId={customer.id} companyId={customer.company_id} />
              ) : (
                <p className="text-sm text-muted-foreground">Customer is missing a company reference.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="relationship" className="mt-4">
          <Card className="bg-card">
            <CardContent className="p-6 space-y-3">
              <p className="font-semibold text-sm">Internal Notes</p>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{customer.notes || "No notes for this client yet."}</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <QuickTemplateDialog
        open={showTemplatePicker}
        onClose={() => setShowTemplatePicker(false)}
        customerId={id}
        quoteName={customer?.name ? `Quote - ${customer.name}` : undefined}
      />
    </div>
  );
};

type ChipTone = "slate" | "blue" | "emerald" | "amber" | "rose";
const CHIP_TONES: Record<ChipTone, string> = {
  slate:   "bg-slate-50 text-slate-700 border-slate-200",
  blue:    "bg-blue-50 text-blue-700 border-blue-200",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  amber:   "bg-amber-50 text-amber-800 border-amber-200",
  rose:    "bg-rose-50 text-rose-700 border-rose-200",
};

const SummaryChips = ({ items }: { items: { label: string; value: string; tone: ChipTone }[] }) => (
  <div className="flex gap-2 overflow-x-auto px-4 pb-3 -mt-1">
    {items.map((it) => (
      <div
        key={it.label}
        className={cn("shrink-0 rounded-lg border px-3 py-2 min-w-[110px]", CHIP_TONES[it.tone])}
      >
        <p className="text-[10px] uppercase tracking-wide opacity-80">{it.label}</p>
        <p className="text-sm font-bold leading-tight mt-0.5">{it.value}</p>
      </div>
    ))}
  </div>
);


const ContactRow = ({
  icon: Icon, value, label, breakAll,
}: { icon: any; value?: string | null; label: string; breakAll?: boolean }) => (
  <div className="flex items-start gap-2">
    <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", value ? "text-primary" : "text-muted-foreground/50")} />
    {value ? (
      <span className={cn(breakAll && "break-all")}>{value}</span>
    ) : (
      <span className="text-muted-foreground italic">{label}</span>
    )}
  </div>
);

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div>
    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
    <p className="text-sm font-bold mt-1">{value}</p>
  </div>
);

const SectionHeader = ({ title, onNew, cta }: { title: string; onNew: () => void; cta: string }) => (
  <div className="flex items-center justify-between px-4 pb-3">
    <p className="font-semibold text-sm">{title}</p>
    <Button size="sm" variant="outline" onClick={onNew}>{cta}</Button>
  </div>
);

const EmptyRow = ({ cols, text }: { cols: number; text: string }) => (
  <TableRow>
    <TableCell colSpan={cols} className="text-center text-sm text-muted-foreground py-8">{text}</TableCell>
  </TableRow>
);


export default AdminCustomerDetailPage;
