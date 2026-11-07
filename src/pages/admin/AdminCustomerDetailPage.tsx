import { HOUSE_EMBED, invoiceHouseLabel, invoiceHouseHref } from "@/lib/invoiceHouse";
import { dueRowTitle } from "@/lib/invoiceDue";
import { BalanceDueBlock } from "@/components/invoicing/BalanceDueBlock";
import { useInvoiceDue } from "@/hooks/useInvoiceDue";
import OwnerRepChip from "@/components/requests/OwnerRepChip";
import { randShort } from "@/lib/invoiceDue";
import { InvoiceDueChip, FollowupReview } from "@/components/invoiceDue/InvoiceDueChip";
import { Fragment, useEffect, useMemo, useState } from "react";
import SendQuotesTogetherDialog from "@/components/quoting/SendQuotesTogetherDialog";
import AddPaymentDialog, { type UnpaidInvoice } from "@/components/invoicing/AddPaymentDialog";
import SendReminderDialog from "@/components/invoicing/SendReminderDialog";
import { sendTogetherBlock } from "@/lib/quoteBundle";
import { useDraftNeeds } from "@/hooks/useDraftNeeds";
import { DraftNeedsChip } from "@/components/quoting/DraftNeedsChip";
import { Checkbox } from "@/components/ui/checkbox";
import { useParams, useNavigate, useSearchParams, Link } from "react-router-dom";
import ProjectsList from "@/components/projects/ProjectsList";
import ClientSectionNav from "@/components/customers/ClientSectionNav";
import { clientTabChips, sumHouseCounts } from "@/lib/clientTabChips";
import { useProjects } from "@/hooks/useProjectTracker";
import ContractsList from "@/components/agreements/ContractsList";
import CallHistoryPanel from "@/components/calls/CallHistoryPanel";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useRole } from "@/hooks/useRole";
import RowMenu from "@/components/shared/RowMenu";
import CreateLeadDialog from "@/components/CreateLeadDialog";
import { useQuoteDeleteArchive } from "@/components/quoting/QuoteDeleteArchive";
import { useSalesRep } from "@/hooks/useSalesRep";
import SupplierDocsSection from "@/components/supplierDocs/SupplierDocsSection";
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
import { summarizeInvoices, finalInvoiceStep } from "@/lib/invoiceMoney";
import FinalInvoiceCTA from "@/components/invoicing/FinalInvoiceCTA";
import { CustomerPaymentsTab, CustomerPhotosTab, CustomerDocumentsTab, CustomerHistoryTab } from "@/components/customers/CustomerRecordTabs";
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
import CustomerContactsManager from "@/components/customers/CustomerContactsManager";
import CustomerSitesManager, { sitesLabel } from "@/components/customers/CustomerSitesManager";
import CustomerStatementPanel from "@/components/customers/CustomerStatementPanel";
import CustomerNotesPanel from "@/components/customers/CustomerNotesPanel";
import QuickTemplateDialog from "@/components/quoting/QuickTemplateDialog";
import { UpcomingLine, ClientBookingsList, BookingActivity, useClientBookings } from "@/components/bookings/Bookings";
import { ClientActivity, PaymentTermsChip, SitesOverview } from "@/components/customers/ClientV8Parts";
import { InvoiceTermsOverride } from "@/components/invoiceDue/InvoiceTermsOverride";
import ClientDetailsEditor from "@/components/customers/ClientDetailsEditor";
import { EditClientButton } from "@/components/customers/EditClientButton";
import { clientHeaderName } from "@/lib/clientAddresses";
import { useRegisterAssistantContext } from "@/hooks/useAssistantContextTracker";

import { LEAD_SOURCE_BADGE } from "@/lib/leadSources";
import { LEAD_SOURCE_OPTIONS, DEFAULT_LEAD_SOURCE, toLeadSourceValue, leadSourceLabel } from "@/lib/leadSources";

const LEAD_SOURCE_STYLES: Record<string, string> = LEAD_SOURCE_BADGE;

const statusBadge = (status?: string | null) => {
  const s = (status || "").toLowerCase();
  if (s === "paid" || s === "accepted" || s === "completed" || s === "active") return "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-400/30";
  if (s === "overdue" || s === "declined") return "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-400/30";
  if (s === "draft") return "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-400/15 dark:text-slate-200 dark:border-slate-400/30";
  if (s === "sent" || s === "viewed" || s === "scheduled" || s === "in_progress") return "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-400/30";
  return "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-400/30";
};

const getInitials = (first?: string | null, last?: string | null, company?: string | null) => {
  const src = company || `${first || ""} ${last || ""}`.trim();
  return src.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join("") || "?";
};

const AdminCustomerDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const [innerTab, setInnerTab] = useState(() => (searchParams.get("tab") === "details" ? "details" : "activity"));
  const { data: _bookings = [] } = useClientBookings(id);
  const bookingsN = _bookings.length;
  const [showArchivedInv, setShowArchivedInv] = useState(false);
  const [site, setSite] = useState<string>("all");
  const [contractSignal, setContractSignal] = useState(0);
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showCreateLead, setShowCreateLead] = useState(false);
  const { isAdmin, isDispatcher } = useRole();
  const quoteDeleteArchive = useQuoteDeleteArchive();
  const { isSalesRep } = useSalesRep();
  const canAssignRep = isAdmin && !isSalesRep;
  const canArchiveClient = (isAdmin || isDispatcher) && !isSalesRep; // office only; DB enforces the same
  // Statements are company finance: office staff only (RPC enforces the same).
  const canSeeStatement = isAdmin && !isSalesRep;
  const showProjects = isAdmin && !isSalesRep;
  // Same projects query the Projects tab uses, so the chip can show the house count already on this client.
  const { data: clientProjects = [] } = useProjects(id, !!id && showProjects);
  const [savingRep, setSavingRep] = useState(false);

  const { data: customer, isLoading } = useQuery({
    queryKey: ["customer-detail", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: salesReps = [] } = useQuery({
    queryKey: ["customer-sales-reps", customer?.company_id],
    enabled: canAssignRep && !!customer?.company_id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("company_id", customer!.company_id!)
        .in("dispatch_role", ["sales", "sales_engineer"])
        .order("full_name");
      if (error) throw error;
      return (data || []) as { id: string; full_name: string | null }[];
    },
  });

  const saveAssignedRep = async (value: string) => {
    if (!id) return;
    setSavingRep(true);
    const assigned = value === "none" ? null : value;
    // owner_rep_id is the single rep field (assigned_rep_id is a DB-side mirror)
    // admin-only RPC for set AND clear, so every change is checked and logged server-side
    const { data, error } = await supabase.rpc("set_customer_owner_rep" as any, {
      p_customer_id: id, p_rep_id: assigned, p_reason: assigned ? "Admin set on client page" : "Admin cleared on client page",
    });
    setSavingRep(false);
    const res = data as { ok?: boolean; message?: string } | null;
    if (error || res?.ok === false) {
      toast({ title: "Could not save sales rep", description: error?.message ?? res?.message, variant: "destructive" });
      return;
    }
    qc.invalidateQueries({ queryKey: ["customer-detail", id] });
    qc.invalidateQueries({ queryKey: ["owner-rep"] });
    toast({ title: assigned ? "Dedicated sales rep saved" : "Dedicated sales rep removed" });
  };

  const [removing, setRemoving] = useState(false);
  const clientAction = async (mode: "archive" | "restore" | "delete") => {
    if (!id) return;
    if (mode === "archive" && !window.confirm("Archive this client? They disappear from the client list but all quotes, invoices and jobs are kept. You can restore them later.")) return;
    if (mode === "delete" && !window.confirm("Delete this client permanently? This cannot be undone.")) return;
    setRemoving(true);
    const { data, error } = await (supabase as any).rpc("delete_or_archive_client", { p_customer_id: id, p_mode: mode });
    setRemoving(false);
    if (error) { toast({ title: "Could not update client", description: error.message, variant: "destructive" }); return; }
    const res = data as { status: string; links?: string[] };
    if (res?.status === "blocked") {
      toast({ title: "Can't delete this client", description: `They have ${(res.links || []).join(", ")} on file. Archive them instead to keep that history.`, variant: "destructive" });
      return;
    }
    qc.invalidateQueries({ queryKey: ["all-customers-fb"] });
    if (res?.status === "deleted") { toast({ title: "Client deleted" }); navigate("/admin/customers"); return; }
    qc.invalidateQueries({ queryKey: ["customer-detail", id] });
    toast({ title: res?.status === "archived" ? "Client archived" : "Client restored" });
  };

  const [savingType, setSavingType] = useState(false);
  const saveClientType = async (value: string) => {
    if (!id) return;
    setSavingType(true);
    const client_type = value === "unset" ? null : value;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- client_type not yet in generated types
    const { error } = await (supabase as any).from("customers").update({ client_type }).eq("id", id);
    setSavingType(false);
    if (error) {
      toast({ title: "Could not save client type", description: error.message, variant: "destructive" });
      return;
    }
    qc.invalidateQueries({ queryKey: ["customer-detail", id] });
    toast({ title: "Client type saved" });
  };

  // Tell the voice assistant which client is open on screen.
  useRegisterAssistantContext({
    selected_customer_id: id,
    selected_customer_name: customer?.name ?? undefined,
  });

  const { byInvoice: dueBy } = useInvoiceDue();
  const [reviewInv, setReviewInv] = useState<string | null>(null);
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
        .select(`id, invoice_number, notes, line_items, issue_date, due_date, grand_total, status, sent_at, final_sent_at, final_sent_channel, created_at, archived_at, customer_id, customer_name, location_id, payment_terms_basis, payment_terms_days, deposit_amount, deposit_type, ${HOUSE_EMBED}`)
        .or(orParts.join(","))
        .order("created_at", { ascending: false });
      if (error) throw error;
      const seen = new Set<string>();
      return (data || []).filter((r: any) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
    },
  });

  const archiveInvoice = async (inv: any, archive: boolean) => {
    const { error } = await (supabase.rpc as any)("archive_void_invoice", { p_invoice_id: inv.id, p_archive: archive });
    if (error) { toast({ title: "Could not update", description: error.message, variant: "destructive" }); return; }
    toast({ title: archive ? `${inv.invoice_number} archived` : `${inv.invoice_number} restored` });
    qc.invalidateQueries({ queryKey: ["customer-invoices", id] });
  };

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
        .select("id, company_id, quote_number, notes, client_summary, total, status, created_at, customer_id, customer_name, location_id, archived_at")
        .or(orParts.join(","))
        .neq("status", "superseded")
        .is("archived_at", null)
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
        .select("id, title, description, status, scheduled_for, created_at, completed_at, invoice_id, lead_id, location_id")
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
      if ((inv as any).archived_at || ["void", "cancelled"].includes(String(inv.status || "").toLowerCase())) continue;
      const date = inv.issue_date || inv.created_at;
      if (!date) continue;
      const key = format(new Date(date), "yyyy-MM");
      const bucket = buckets.find(b => b.key === key);
      if (bucket) bucket.amount += Number(inv.grand_total || 0);
    }
    return buckets;
  }, [invoices]);

  const [pickedQuotes, setPickedQuotes] = useState<string[]>([]);
  const [bundleOpen, setBundleOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payList, setPayList] = useState<UnpaidInvoice[]>([]);
  const [payInv, setPayInv] = useState<string | null>(null);
  const [sendOneOpen, setSendOneOpen] = useState(false);
  const [remOpen, setRemOpen] = useState(false);
  const [remList, setRemList] = useState<UnpaidInvoice[]>([]);
  const pickedRows = (quotes as any[]).filter((q) => pickedQuotes.includes(q.id));
  const draftNeeds = useDraftNeeds((quotes as any[]).filter((q) => (q.status || "draft") === "draft").map((q) => ({ id: q.id, customer_id: q.customer_id || id })));
  const bundleBlock = sendTogetherBlock(pickedRows.map((q) => ({ id: q.id, status: q.status, customer_id: q.customer_id || id, quote_number: q.quote_number, needs: draftNeeds[q.id] })));
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

  const invIdsKey = (invoices as any[]).map((i: any) => i.id).join(",");
  const { data: invPayments = [] } = useQuery({
    queryKey: ["cust-payments", invIdsKey], enabled: invIdsKey.length > 0,
    queryFn: async () => (await (supabase as any).from("payments").select("invoice_id,amount,status").in("invoice_id", invIdsKey.split(","))).data || [],
  });
  const invoiceSummary = useMemo(() => summarizeInvoices(invoices as any[], invPayments as any[], new Date(), dueBy as any), [invoices, invPayments, dueBy]);

  const { data: locations = [] } = useQuery({
    queryKey: ["customer-locations", id], enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("customer_locations").select("*").eq("customer_id", id!)
        .order("is_primary", { ascending: false }).order("created_at", { ascending: true });
      if (error) throw error;
      return (data || []) as any[];
    },
  });
  const bySite = <T extends { location_id?: string | null }>(arr: T[]) => (site === "all" ? arr : arr.filter((x) => x.location_id === site));
  const activeInvRows = (invoices as any[]).filter((inv: any) => !inv.archived_at);
  const archivedInvRows = (invoices as any[]).filter((inv: any) => !!inv.archived_at);
  const fInvoices = bySite(activeInvRows); const fQuotes = bySite(quotes as any[]); const fJobs = bySite(jobs as any[]);
  const fInvTableRows = bySite(showArchivedInv ? archivedInvRows : activeInvRows);
  const money = useMemo(() => {
    let outstanding = 0, overdue = 0, overdueN = 0, maxLate = 0, waiting = 0;
    for (const inv of invoices as any[]) {
      if ((inv as any).archived_at) continue;
      const r = dueBy.get(inv.id); if (!r) continue;
      outstanding += Number(r.amount_due) || 0;
      if (r.waiting) waiting += Number(r.amount_due) || 0;
      if (!r.waiting && r.days > 0) { overdue += Number(r.amount_due) || 0; overdueN++; maxLate = Math.max(maxLate, r.days); }
    }
    return { outstanding: invoiceSummary.outstanding, overdue, overdueN, maxLate, waiting };
  }, [invoices, dueBy, invoiceSummary]);
  const openQuotes = (quotes as any[]).filter((q) => ["draft", "sent", "viewed", "pending"].includes((q.status || "draft").toLowerCase()));
  const unpaid: UnpaidInvoice[] = useMemo(() => (invoices as any[])
    .filter((inv) => !inv.archived_at && !["paid", "void", "cancelled", "draft"].includes((inv.status || "").toLowerCase()))
    .map((inv) => { const r = dueBy.get(inv.id); return { id: inv.id, invoice_number: inv.invoice_number, house: invoiceHouseLabel(inv), grand_total: Number(inv.grand_total) || 0, amount_due: Number(r?.amount_due) || 0, days: r && !r.waiting ? r.days : 0, waiting: !!r?.waiting, _d: inv.due_date || inv.issue_date || inv.created_at || "" }; })
    .filter((i) => i.amount_due > 0.005)
    .sort((x, y) => String(x._d).localeCompare(String(y._d))), [invoices, dueBy]);
  const overdueUnpaid = unpaid.filter((i) => (i.days || 0) > 0);
  const owing = unpaid.length > 0;
  // Balances still "Due on completion" are never chased (Johan 2 Nov 17:49).
  const remindable = unpaid.filter((i) => !i.waiting);
  const sendQuote = [...openQuotes].sort((x, y) => String(y.created_at || "").localeCompare(String(x.created_at || "")))[0] as any | undefined;
  const sendIsResend = !!sendQuote && (sendQuote.status || "draft").toLowerCase() !== "draft";
  const openRem = (list: UnpaidInvoice[]) => { setRemList(list.length ? list : unpaid); setRemOpen(true); };
  const openPay = (list: UnpaidInvoice[], invId?: string | null) => { setPayList(list.length ? list : unpaid); setPayInv(invId ?? null); setPayOpen(true); };

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
  const headerName = clientHeaderName(customer);
  const contactName = customer.is_company ? fullName : headerName;
  const structuredAddress = [customer.primary_address_line1, customer.primary_address_line2, customer.city, customer.postal_code]
    .filter(Boolean).join(", ");
  // Fall back to the free-text address (what phone/WhatsApp intake writes) so the
  // profile card is never blank when an address is actually on file.
  const fullAddress = structuredAddress || (customer.address || "").trim();

  const sectionChips = clientTabChips({
    quoteCount: quotes.length,
    quoteOpenValue: quoteSummary.openValue,
    invoiceCount: activeInvRows.length,
    invoiceOutstanding: money.outstanding,
    jobCount: jobs.length + bookingsN,
    siteCount: locations.length,
    showProjects,
    projectCount: clientProjects.length,
    houseCount: sumHouseCounts(clientProjects),
  });
  const more: [string, string][] = [["details", "Client details"], ["contacts", "Contacts"], ["contracts", "Contracts"], ["notes", "Notes"], ...(canSeeStatement ? [["statement", "Statement"] as [string, string]] : []), ["calls", "Calls"], ["photos", "Photos"], ["documents", "Documents"], ...((isAdmin || isDispatcher) && !isSalesRep ? [["supplierdocs", "Supplier documents (private)"] as [string, string]] : []), ["history", "History"], ["credits", "Credits"], ["oldsites", `${sitesLabel((customer as any).client_type)} (old list)`], ["relationship", "Relationship"]];
  const moreLabel = more.find(([v]) => v === innerTab)?.[1];
  const phone = (customer as any).phone as string | null; const email = (customer as any).email as string | null;
  const showSiteFilter = locations.length > 1 && ["quotes", "invoices", "jobs"].includes(innerTab);
  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto" data-testid="client-page-v8">
      {/* One back arrow: the shared header BackButton (Johan 31 Oct). */}

      {/* Money owing sits at the very top in bold orange (Johan 2 Nov 17:49). */}
      {owing && (
        <div data-testid="client-owing-strip" className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border-2 border-[#F97316] bg-[#FFF7ED] p-3 dark:bg-[#F97316]/10">
          <div className="min-w-0 text-[#F97316]">
            <p className="text-lg font-bold leading-tight sm:text-xl">
              {randShort(money.outstanding)} outstanding{money.overdue > 0 ? ` · ${randShort(money.overdue)} overdue` : ""}
            </p>
            {money.waiting > 0 && <p data-testid="client-owing-waiting" className="text-sm font-semibold">{randShort(money.waiting)} due on completion</p>}
          </div>
          <div className="flex gap-2">
            <Button data-testid="strip-add-payment" onClick={() => openPay(unpaid)} className="h-11 rounded-xl bg-[#F97316] font-semibold text-white hover:bg-[#EA580C]"><Plus className="mr-1 h-4 w-4" /> Add payment</Button>
            {remindable.length > 0 && <Button data-testid="strip-send-reminder" variant="outline" onClick={() => openRem(remindable)} className="h-11 rounded-xl border-[#F97316] font-semibold text-[#C2410C] hover:bg-[#FFEDD5]"><Mail className="mr-1 h-4 w-4" /> Send reminder</Button>}
          </div>
        </div>
      )}

      {/* Header: name, contact, quick actions, money */}
      <div className="rounded-2xl bg-gradient-to-br from-[#0F2A44] to-[#1590D6] p-4 text-white sm:p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold leading-tight sm:text-2xl break-words">{headerName}</h1>
              {customer.status === "archived" && <span className="rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold">Archived</span>}
            </div>
            <p className="mt-1 text-sm text-[#CFE6F6] break-words">
              {[(customer as any).client_type && String((customer as any).client_type).replace(/^./, (c: string) => c.toUpperCase()), leadSourceLabel(customer.lead_source), (customer as any).owner_rep_id && salesReps.find((r) => r.id === (customer as any).owner_rep_id)?.full_name && `Rep: ${salesReps.find((r) => r.id === (customer as any).owner_rep_id)?.full_name}`].filter(Boolean).join(" · ")}
            </p>
            <p className="mt-0.5 text-sm text-[#CFE6F6] break-words">{[contactName && contactName !== headerName ? contactName : null, phone, email, fullAddress].filter(Boolean).join(" · ") || "No contact details yet"}</p>
            <UpcomingLine customerId={customer.id} />
            <OwnerRepChip customerId={customer.id} companyId={(customer as any).company_id} ownerRepId={(customer as any).owner_rep_id} canEdit={isAdmin && !isSalesRep} />
            <div className="mt-2"><PaymentTermsChip customerId={customer.id} basis={(customer as any).payment_terms_basis} days={(customer as any).payment_terms_days} finalDays={(customer as any).final_after_days} canEdit={isAdmin && !isSalesRep} onSaved={() => qc.invalidateQueries({ queryKey: ["customer-detail", id] })} /></div>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {phone && <a href={`tel:${phone}`} className="inline-flex items-center gap-1 rounded-xl bg-white/15 px-3 py-2 text-sm hover:bg-white/25"><Phone className="h-4 w-4" /> Call</a>}
            {email && <a href={`mailto:${email}`} className="inline-flex items-center gap-1 rounded-xl bg-white/15 px-3 py-2 text-sm hover:bg-white/25"><Mail className="h-4 w-4" /> Email</a>}
            {owing && <Button data-testid="client-add-payment" onClick={() => openPay(unpaid)} className="rounded-xl bg-[#F7941D] hover:bg-[#e08310] text-white"><Plus className="h-4 w-4 mr-1" /> Add payment</Button>}
            <EditClientButton onClick={() => setInnerTab("details")} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button data-testid="client-new-quote" className={cn("rounded-xl text-white", owing ? "bg-white/15 hover:bg-white/25" : "bg-[#F7941D] hover:bg-[#e08310]")}><Plus className="h-4 w-4 mr-1" /> New quote <ChevronDown className="h-4 w-4 ml-1" /></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {(isAdmin || isDispatcher) && <DropdownMenuItem data-testid="menu-new-lead" onClick={() => setShowCreateLead(true)}>New lead</DropdownMenuItem>}
                <DropdownMenuItem onClick={() => setShowTemplatePicker(true)}>Quote from Template</DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate(`/admin/quotes?customerId=${id}`)}>New Blank Quote</DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/admin/invoices")}>New Invoice</DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate("/admin/jobs")}>New Job</DropdownMenuItem>
                <DropdownMenuItem data-testid="menu-create-service-contract" onClick={() => { setInnerTab("contracts"); setContractSignal((n) => n + 1); }}>Service contract</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button aria-label="More actions" className="rounded-xl bg-white/15 hover:bg-white/25 text-white px-3">⋯</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {owing && <DropdownMenuItem data-testid="menu-add-payment" onClick={() => openPay(unpaid)}>Add payment</DropdownMenuItem>}
                {sendQuote && <DropdownMenuItem data-testid="menu-send-quote" onClick={() => setSendOneOpen(true)}>{sendIsResend ? "Resend quote" : "Send quote"} {sendQuote.quote_number ? `(${sendQuote.quote_number})` : ""}</DropdownMenuItem>}
                <DropdownMenuItem data-testid="menu-edit-client-details" onClick={() => setInnerTab("details")}>Edit client details</DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate(`/admin/customers`)}>Back to list</DropdownMenuItem>
                {canArchiveClient && (customer.status === "archived" ? (
                  <DropdownMenuItem disabled={removing} onClick={() => clientAction("restore")}>Restore client</DropdownMenuItem>
                ) : (
                  <DropdownMenuItem disabled={removing} onClick={() => clientAction("archive")}>Archive client</DropdownMenuItem>
                ))}
                {canArchiveClient && (
                  <DropdownMenuItem disabled={removing} className="text-destructive focus:text-destructive" onClick={() => clientAction("delete")}>Delete client permanently</DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2" data-testid="client-money">
          <MoneyTile testId="tile-outstanding" label="Outstanding" value={randShort(money.outstanding)} onClick={() => setInnerTab("invoices")} action={owing ? { label: "Add payment", onClick: () => openPay(unpaid) } : undefined} action2={remindable.length ? { label: "Send reminder", onClick: () => openRem(remindable) } : undefined} />
          <MoneyTile testId="tile-overdue" label="Overdue" value={randShort(money.overdue)} hot={money.overdue > 0} sub={money.overdueN ? `${money.overdueN} · ${money.maxLate}d` : undefined} onClick={() => setInnerTab("invoices")} action={overdueUnpaid.length ? { label: "Add payment", onClick: () => openPay(overdueUnpaid) } : undefined} action2={overdueUnpaid.length ? { label: "Send reminder", onClick: () => openRem(overdueUnpaid) } : undefined} />
          <MoneyTile label="Open quotes" value={randShort(quoteSummary.openValue)} sub2={`${openQuotes.length} open`} onClick={() => setInnerTab("quotes")} />
        </div>
      </div>

      {/* Section chips sit under the client header and stay pinned while the record scrolls (Johan 5 Nov). */}
      <div className="sticky top-0 z-30 -mx-4 space-y-2 bg-background/70 px-4 py-1.5 backdrop-blur-md md:-mx-6 md:px-6" data-testid="client-section-tabs">
        <ClientSectionNav
          chips={sectionChips}
          active={innerTab}
          onSelect={setInnerTab}
          more={more.map(([key, label]) => ({ key, label }))}
          moreLabel={moreLabel}
        />
        {showSiteFilter && (
          <div className="flex gap-1.5 flex-wrap items-center text-xs" data-testid="site-filter">
            <span className="text-muted-foreground">Site:</span>
            {[{ id: "all", label: "All" }, ...locations].map((l: any) => (
              <button key={l.id} type="button" onClick={() => setSite(l.id)} className={cn("rounded-full px-2.5 py-1", site === l.id ? "bg-[#1590D6] text-white" : "bg-card border")}>{l.label || l.address || "Site"}</button>))}
          </div>
        )}
      </div>

      {(invoices as any[]).filter((inv) => !inv.archived_at && Number(inv.deposit_amount) > 0 && !["paid", "void", "cancelled", "draft"].includes((inv.status || "").toLowerCase()) && (inv.deposit_type || "") !== "deposit_invoice")
        .map((inv) => <BalanceDueBlock key={inv.id} invoiceId={inv.id} onRecordPayment={() => openPay(unpaid.filter((u) => u.id === inv.id), inv.id)} />)}
      <SendReminderDialog open={remOpen} onOpenChange={setRemOpen} invoices={remList} onDone={() => qc.invalidateQueries()} />
      <AddPaymentDialog open={payOpen} onOpenChange={setPayOpen} invoices={payList} initialId={payInv} onDone={() => qc.invalidateQueries()} />
      {sendQuote && <SendQuotesTogetherDialog open={sendOneOpen} onOpenChange={setSendOneOpen} quoteIds={[sendQuote.id]} onSent={() => qc.invalidateQueries()} />}

      <FinalInvoiceCTA step={finalInvoiceStep(invoices as any[], invPayments as any[], jobs as any[])} />

      <Tabs value={innerTab} onValueChange={setInnerTab}>
        <TabsContent value="activity" className="mt-0">
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="rounded-2xl md:col-span-2"><CardContent className="p-4">
              <p className="font-semibold mb-2">Activity <span className="text-xs font-normal text-muted-foreground">calls, emails, notes, follow-ups</span></p>
              <BookingActivity customerId={customer.id} />
              <ClientActivity customerId={customer.id} companyId={customer.company_id ?? null} quotes={quotes as any[]} jobs={jobs as any[]} />
            </CardContent></Card>
            <Card className="rounded-2xl"><CardContent className="p-4">
              <p className="font-semibold mb-2">Invoices due</p>
              {(invoices as any[]).filter((inv) => dueBy.get(inv.id)).length === 0 ? <p className="text-sm text-muted-foreground">Nothing outstanding.</p> : (
                <ul className="divide-y">{(invoices as any[]).filter((inv) => dueBy.get(inv.id)).map((inv) => (
                  <li key={inv.id} data-testid="invoice-due-row" className="flex flex-col items-start gap-1 py-2 text-sm">
                    <button type="button" className="w-full min-w-0 break-words text-left font-semibold hover:underline" onClick={() => navigate(`/admin/invoices/${inv.id}`)}>{dueRowTitle(invoiceHouseLabel(inv), inv.invoice_number, formatRand(Number(dueBy.get(inv.id)!.amount_due || 0)))}</button>
                    <InvoiceDueChip short row={dueBy.get(inv.id)!} onClick={() => { setInnerTab("invoices"); setReviewInv(inv.id); }} />
                  </li>))}</ul>)}
            </CardContent></Card>
          </div>
        </TabsContent>

        <TabsContent value="invoices" className="mt-0"><Card className="rounded-2xl"><CardContent className="p-0 pt-4">
          <SectionHeader title="Invoices & Payments" onNew={() => navigate("/admin/invoices")} cta="+ New Invoice" />
          <SummaryChips
            items={[
              { label: "Outstanding", value: formatRand(invoiceSummary.outstanding), tone: invoiceSummary.outstanding > 0 ? "amber" : "slate" },
              { label: "Overdue", value: String(money.overdueN), tone: money.overdueN > 0 ? "rose" : "slate" },
              { label: "Paid", value: `${invoiceSummary.paidInvoices} · ${formatRand(invoiceSummary.paidValue)}`, tone: "emerald" },
              { label: "Draft", value: String(invoiceSummary.draft), tone: "slate" },
            ]}
          />
                  {archivedInvRows.length > 0 && (
                    <div className="px-2 md:px-4 mt-2">
                      <Button size="sm" variant={showArchivedInv ? "default" : "outline"} onClick={() => setShowArchivedInv((v) => !v)}>
                        Archived <span className="ml-1 opacity-70">{archivedInvRows.length}</span>
                      </Button>
                    </div>
                  )}
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
                        {fInvTableRows.map((inv: any) => (
                          <Fragment key={inv.id}>
                          <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/admin/invoices/${inv.id}`)}>
                            <TableCell className="font-medium">{inv.invoice_number || "—"}</TableCell>
                            <TableCell className="min-w-[160px] max-w-[320px] text-muted-foreground text-xs">{invoiceHouseLabel(inv) && <div data-testid="invoice-house" className="font-bold text-sm text-foreground">{invoiceHouseHref(inv) ? <Link to={invoiceHouseHref(inv)!} onClick={(e) => e.stopPropagation()} data-testid="invoice-house-link" className="text-[#1590D6] hover:underline">{invoiceHouseLabel(inv)} ↗</Link> : invoiceHouseLabel(inv)}</div>}<div className="line-clamp-2 break-words" title={inv.notes || undefined}>{inv.notes || "—"}</div></TableCell>
                            <TableCell className="text-xs">{inv.issue_date ? format(new Date(inv.issue_date), "dd MMM yyyy") : "—"}</TableCell>
                            <TableCell className="text-xs">{inv.due_date ? format(new Date(inv.due_date), "dd MMM yyyy") : "—"}</TableCell>
                            <TableCell className="text-right font-medium">{formatRand(Number(inv.grand_total || 0))}</TableCell>
                            <TableCell><div className="flex flex-wrap items-center gap-1"><Badge variant="outline" className={cn("text-xs", statusBadge(inv.status))}>{inv.status || "draft"}</Badge>{dueBy.get(inv.id) && <InvoiceDueChip row={dueBy.get(inv.id)!} onClick={() => setReviewInv(reviewInv === inv.id ? null : inv.id)} />}{(isAdmin || isDispatcher) && !isSalesRep && ["void", "cancelled"].includes((inv.status || "").toLowerCase()) && <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={(e) => { e.stopPropagation(); archiveInvoice(inv, !inv.archived_at); }}>{inv.archived_at ? "Restore" : "Archive"}</Button>}</div></TableCell>
                          </TableRow>
                          {reviewInv === inv.id && dueBy.get(inv.id) && <TableRow key={inv.id + "-review"}><TableCell colSpan={6}><FollowupReview row={dueBy.get(inv.id)!} onDone={() => setReviewInv(null)} />{isAdmin && !isSalesRep && <InvoiceTermsOverride invoice={inv} />}</TableCell></TableRow>}
                          </Fragment>
                        ))}
                        {fInvTableRows.length === 0 && <EmptyRow cols={6} text={showArchivedInv ? "No archived invoices." : "No invoices yet."} />}
                      </TableBody>
                    </Table>
                  </div>
          <div className="border-t px-4 pt-4"><p className="font-semibold text-sm mb-2">Payments</p></div>
          <CustomerPaymentsTab invoices={fInvoices as any[]} />
        </CardContent></Card></TabsContent>

        <TabsContent value="quotes" className="mt-0"><Card className="rounded-2xl"><CardContent className="p-0 pt-4">
          <SectionHeader title="Estimates / Quotes" onNew={() => setShowTemplatePicker(true)} cta="+ Quote from Template" />
          <SummaryChips
            items={[
              { label: "Open value", value: formatRand(quoteSummary.openValue), tone: quoteSummary.openValue > 0 ? "blue" : "slate" },
              { label: "Sent", value: String(quoteSummary.sent), tone: "blue" },
              { label: "Accepted", value: `${quoteSummary.accepted} · ${formatRand(quoteSummary.acceptedValue)}`, tone: "emerald" },
              { label: "Draft", value: String(quoteSummary.draft), tone: "slate" },
              { label: "Declined", value: String(quoteSummary.declined), tone: quoteSummary.declined > 0 ? "rose" : "slate" },
            ]}
          />
                  {pickedQuotes.length > 0 && (
                    <div className="mx-2 md:mx-4 mb-2 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2">
                      <p className="text-sm text-muted-foreground min-w-0 break-words">{pickedQuotes.length} selected{bundleBlock ? ` · ${bundleBlock}` : ""}</p>
                      <Button size="sm" disabled={!!bundleBlock} onClick={() => setBundleOpen(true)} className="bg-[#F7941D] hover:bg-[#e08310] text-white">Send together</Button>
                    </div>
                  )}
                  <SendQuotesTogetherDialog open={bundleOpen} onOpenChange={setBundleOpen} quoteIds={pickedQuotes} onSent={() => setPickedQuotes([])} />
                  <ul className="md:hidden space-y-2 px-2 pb-4" data-testid="client-quote-cards">
                    {fQuotes.map((q: any) => (
                      <li key={q.id} data-testid="client-quote-card" className="rounded-xl border bg-card p-3 cursor-pointer active:bg-muted/50" onClick={() => navigate(`/admin/quote-builder?quoteId=${q.id}`)}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold">{q.quote_number || "—"}</div>
                            <div className="text-xs text-muted-foreground">{q.created_at ? format(new Date(q.created_at), "dd MMM yyyy") : "—"}</div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-base font-bold tabular-nums">{formatRand(Number(q.total || 0))}</div>
                            <div className="text-[10px] text-muted-foreground">incl. VAT</div>
                          </div>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <Badge variant="outline" className={cn("text-xs", statusBadge(q.status))}>{q.status || "draft"}</Badge>
                          <DraftNeedsChip needs={draftNeeds[q.id]} />
                        </div>
                        {(q.client_summary || q.notes) && <div className="mt-1.5 line-clamp-2 break-words text-xs text-muted-foreground">{q.client_summary || q.notes}</div>}
                      </li>
                    ))}
                    {fQuotes.length === 0 && <li className="py-4 text-center text-sm text-muted-foreground">No quotes yet.</li>}
                  </ul>
                  <div className="hidden md:block max-h-[560px] overflow-auto px-2 md:px-4 pb-6">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8"></TableHead>
                          <TableHead>Quote #</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead>Date</TableHead>
                          <TableHead className="text-right">Total incl. VAT</TableHead>
                          <TableHead>Status</TableHead>
                          {isAdmin && <TableHead className="w-10"><span className="sr-only">Actions</span></TableHead>}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {fQuotes.map((q: any) => (
                          <TableRow key={q.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/admin/quote-builder?quoteId=${q.id}`)}>
                            <TableCell className="w-8" onClick={(e) => e.stopPropagation()}>
                              <Checkbox aria-label={`Select ${q.quote_number || "quote"}`} checked={pickedQuotes.includes(q.id)} onCheckedChange={() => setPickedQuotes((p) => (p.includes(q.id) ? p.filter((x) => x !== q.id) : [...p, q.id]))} />
                            </TableCell>
                            <TableCell className="font-medium">{q.quote_number || "—"}</TableCell>
                            <TableCell className="min-w-[160px] max-w-[320px] text-muted-foreground text-xs"><div className="line-clamp-2 break-words" title={q.client_summary || q.notes || undefined}>{q.client_summary || q.notes || "—"}</div></TableCell>
                            <TableCell className="text-xs">{q.created_at ? format(new Date(q.created_at), "dd MMM yyyy") : "—"}</TableCell>
                            <TableCell className="text-right font-medium">{formatRand(Number(q.total || 0))}</TableCell>
                            <TableCell><Badge variant="outline" className={cn("text-xs", statusBadge(q.status))}>{q.status || "draft"}</Badge> <DraftNeedsChip needs={draftNeeds[q.id]} /></TableCell>
                            {isAdmin && <TableCell className="w-10 p-1 text-right"><RowMenu label={`Actions for ${q.quote_number || "quote"}`} items={quoteDeleteArchive.itemsFor(q).map((i) => ({ ...i, separatorBefore: false }))} /></TableCell>}
                          </TableRow>
                        ))}
                        {fQuotes.length === 0 && <EmptyRow cols={isAdmin ? 7 : 6} text="No quotes yet." />}
                      </TableBody>
                    </Table>
                    {quoteDeleteArchive.dialogs}
                  </div>
        </CardContent></Card></TabsContent>

        <TabsContent value="jobs" className="mt-0"><Card className="rounded-2xl"><CardContent className="p-0 pt-4">
          <ClientBookingsList customerId={customer.id} />
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
                        {fJobs.map((j: any) => (
                          <TableRow key={j.id} className="cursor-pointer hover:bg-muted/50" onClick={() => navigate(`/admin/jobs/${j.id}`)}>
                            <TableCell className="font-medium">{j.title || "Untitled"}</TableCell>
                            <TableCell className="min-w-[160px] max-w-[320px] text-muted-foreground text-xs"><div className="line-clamp-2 break-words" title={j.description || undefined}>{j.description || "—"}</div></TableCell>
                            <TableCell className="text-xs">{(j.scheduled_for || j.created_at) ? format(new Date((j.scheduled_for || j.created_at)!), "dd MMM yyyy") : "—"}</TableCell>
                            <TableCell><Badge variant="outline" className={cn("text-xs", statusBadge(j.status))}>{j.status || "pending"}</Badge></TableCell>
                          </TableRow>
                        ))}
                        {fJobs.length === 0 && <EmptyRow cols={4} text="No jobs yet." />}
                      </TableBody>
                    </Table>
                  </div>
        </CardContent></Card></TabsContent>

        {(isAdmin || isDispatcher) && !isSalesRep && <TabsContent value="supplierdocs" className="mt-0"><SupplierDocsSection companyId={(customer as any).company_id} customerId={customer.id} /></TabsContent>}
        {showProjects && <TabsContent value="projects" className="mt-0"><Card className="rounded-2xl"><CardContent className="p-4"><ProjectsList customerId={customer.id} companyId={(customer as any).company_id} /></CardContent></Card></TabsContent>}
        <TabsContent value="sites" className="mt-0"><Card className="rounded-2xl"><CardContent className="p-4 space-y-4">
          <SitesOverview locations={locations} quotes={quotes as any[]} jobs={jobs as any[]} invoices={invoices as any[]} onPick={(lid) => { setSite(lid); setInnerTab("jobs"); }} />
          {customer.company_id ? <CustomerLocationsManager customerId={customer.id} companyId={customer.company_id} /> : <p className="text-sm text-muted-foreground">Customer is missing a company reference.</p>}
        </CardContent></Card></TabsContent>

        <TabsContent value="details" className="mt-0 space-y-4">
          <Card className="rounded-2xl">
            {/* Contact card — full width so fields have room to edit */}
              <CardContent className="p-6 space-y-4">
                {canAssignRep && (
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Dedicated sales rep</Label>
                    <Select
                      value={(customer as any).owner_rep_id ?? "none"}
                      onValueChange={saveAssignedRep}
                      disabled={savingRep}
                    >
                      <SelectTrigger className="h-9"><SelectValue placeholder="None" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {salesReps.map((r) => (
                          <SelectItem key={r.id} value={r.id}>{r.full_name || "Unnamed"}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Client type</Label>
                  <Select
                    value={(customer as any).client_type ?? "unset"}
                    onValueChange={saveClientType}
                    disabled={savingType}
                  >
                    <SelectTrigger className="h-9"><SelectValue placeholder="Not set" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unset">Not set</SelectItem>
                      <SelectItem value="private">Private</SelectItem>
                      <SelectItem value="company">Company</SelectItem>
                      <SelectItem value="developer">Developer</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Changing this does not hide private or company details.</p>
                </div>
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
                <ClientDetailsEditor
                  customerId={customer.id}
                  companyId={customer.company_id ?? null}
                  initialData={customer as any}
                  locations={locations}
                />

              </CardContent>
            </Card>

          <Card className="rounded-2xl">
              <CardContent className="p-6 space-y-4">
                <div>
                  <p className="text-sm font-semibold">Outstanding Revenue</p>
                  <p className="text-xs text-muted-foreground">Last 6 months</p>
                </div>
                <div className="h-40">
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
        </TabsContent>

        <TabsContent value="calls" className="mt-0"><Card className="rounded-2xl"><CardContent className="p-4"><CallHistoryPanel customerId={id} title="Voice assistant calls" /></CardContent></Card></TabsContent>
        <TabsContent value="relationship" className="mt-0"><Card className="rounded-2xl"><CardContent className="p-6 space-y-3">
          <p className="font-semibold text-sm">Internal Notes</p>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap">{customer.notes || "No notes for this client yet."}</p>
        </CardContent></Card></TabsContent>
        <Card className="rounded-2xl overflow-hidden data-[hide=true]:hidden" data-hide={!["contracts", "contacts", "oldsites", "statement", "notes", "credits", "payments", "photos", "documents", "history"].includes(innerTab)}><CardContent className="p-0">
                <TabsContent value="contracts" className="p-0 mt-0">
                  <ContractsList
                    customerId={customer.id}
                    customerName={(customer as any).company_name || customer.name || undefined}
                    createSignal={contractSignal}
                    invoiceOptions={(invoices as any[]).filter((inv) => inv.customer_id === customer.id).map((inv) => ({ id: inv.id, label: inv.invoice_number || "Invoice", sub: inv.issue_date ? format(new Date(inv.issue_date), "dd MMM yyyy") : undefined }))}
                    jobOptions={(jobs as any[]).filter((j) => !j.customer_id || j.customer_id === customer.id).map((j) => ({ id: j.id, label: j.title || "Job", sub: j.status || undefined }))}
                  />
                </TabsContent>
                <TabsContent value="contacts" className="p-0 mt-0">
                  <CustomerContactsManager customerId={customer.id} />
                </TabsContent>
                <TabsContent value="oldsites" className="p-0 mt-0">
                  <CustomerSitesManager customerId={customer.id} clientType={(customer as any).client_type} />
                </TabsContent>
                {canSeeStatement && (
                  <TabsContent value="statement" className="p-0 mt-0">
                    <CustomerStatementPanel customerId={customer.id} />
                  </TabsContent>
                )}
                <TabsContent value="notes" className="p-0 mt-0">
                  <CustomerNotesPanel customerId={customer.id} companyId={customer.company_id ?? null} />
                </TabsContent>
                <TabsContent value="credits" className="p-6 text-sm text-muted-foreground">
                  No credits on file.
                </TabsContent>
                <TabsContent value="payments" className="p-0 mt-0"><CustomerPaymentsTab invoices={invoices as any[]} /></TabsContent>
                <TabsContent value="photos" className="p-0 mt-0"><CustomerPhotosTab customerId={customer.id} jobs={jobs as any[]} /></TabsContent>
                <TabsContent value="documents" className="p-0 mt-0"><CustomerDocumentsTab customerId={customer.id} quotes={quotes as any[]} /></TabsContent>
                <TabsContent value="history" className="p-0 mt-0"><CustomerHistoryTab customerId={customer.id} quotes={quotes as any[]} invoices={invoices as any[]} jobs={jobs as any[]} /></TabsContent>
        </CardContent></Card>
      </Tabs>

      <CreateLeadDialog open={showCreateLead} onOpenChange={setShowCreateLead} customerId={customer.id} />
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
  slate:   "bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-400/15 dark:text-slate-200 dark:border-slate-400/30",
  blue:    "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-400/30",
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-400/30",
  amber:   "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-400/30",
  rose:    "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-400/30",
};

const SummaryChips = ({ items }: { items: { label: string; value: string; tone: ChipTone }[] }) => (
  <div className="flex gap-2 overflow-x-auto px-4 pb-3 -mt-1">
    {items.map((it) => (
      <div
        key={it.label}
        className={cn("shrink-0 rounded-lg border px-3 py-2 min-w-[110px]", CHIP_TONES[it.tone])}
      >
        <p className="text-xs uppercase tracking-wide opacity-80">{it.label}</p>
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

const MoneyTile = ({ label, value, sub, sub2, hot, onClick, action, action2, testId }: { label: string; value: string; sub?: string; sub2?: string; hot?: boolean; onClick?: () => void; action?: { label: string; onClick: () => void }; action2?: { label: string; onClick: () => void }; testId?: string }) => (
  <div data-testid={testId} className="flex min-w-0 flex-col rounded-xl border border-white/25 hover:bg-white/10">
    <button type="button" onClick={onClick} className="min-w-0 flex-1 px-2.5 py-2 text-left sm:px-3">
      <span className="block truncate text-xs text-[#CFE6F6]">{label}</span>
      <span className={cn("block truncate font-semibold leading-tight text-sm sm:text-lg", hot && "text-[#FFB4B6]")}>{value}</span>
      {sub && <span className="mt-0.5 inline-block rounded-full bg-[#E5484D]/30 px-2 text-[11px]">{sub}</span>}
      {sub2 && <span className="mt-0.5 block text-[11px] text-[#CFE6F6]">{sub2}</span>}
    </button>
    {action && <button type="button" data-testid={testId ? `${testId}-add-payment` : undefined} onClick={action.onClick} className="mx-1.5 mb-1.5 min-h-11 rounded-lg bg-[#F7941D] px-1 text-xs font-semibold text-white hover:bg-[#e08310]">+ {action.label}</button>}
    {action2 && <button type="button" data-testid={testId ? `${testId}-send-reminder` : undefined} onClick={action2.onClick} className="mx-1.5 mb-1.5 min-h-11 rounded-lg border border-white/40 bg-white/10 px-1 text-xs font-semibold text-white hover:bg-white/20">{action2.label}</button>}
  </div>
);

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div>
    <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
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
