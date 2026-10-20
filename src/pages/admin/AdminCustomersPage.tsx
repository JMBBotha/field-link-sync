import { useInvoiceDue } from "@/hooks/useInvoiceDue";
import { useSalesHeartbeat } from "@/hooks/useSalesHeartbeat";
import { randShort } from "@/lib/invoiceDue";
import { format } from "date-fns";
import RowMenu from "@/components/shared/RowMenu";
import CreateLeadDialog from "@/components/CreateLeadDialog";
import { TILE_LINKS } from "@/lib/drilldown";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useSalesRep } from "@/hooks/useSalesRep";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Search, Plus, MoreHorizontal, Mail, Phone, Loader2, Upload, Download, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRand } from "@/utils/formatRand";
import { LEAD_SOURCE_OPTIONS, DEFAULT_LEAD_SOURCE, toLeadSourceValue, leadSourceLabel } from "@/lib/leadSources";
import { LEAD_SOURCE_BADGE } from "@/lib/leadSources";

const LEAD_SOURCE_STYLES: Record<string, { badge: string; border: string }> = {
  manual: { badge: LEAD_SOURCE_BADGE.manual,       border: "border-t-slate-400" },
  facebook_lead: { badge: LEAD_SOURCE_BADGE.facebook_lead,          border: "border-t-blue-500" },
  website_form: { badge: LEAD_SOURCE_BADGE.website_form,       border: "border-t-green-500" },
  website: { badge: LEAD_SOURCE_BADGE.website,       border: "border-t-green-500" },
  whatsapp: { badge: LEAD_SOURCE_BADGE.whatsapp, border: "border-t-emerald-500" },
  phone_call: { badge: LEAD_SOURCE_BADGE.phone_call,    border: "border-t-orange-500" },
  vapi: { badge: LEAD_SOURCE_BADGE.vapi,    border: "border-t-orange-500" },
  walk_in: { badge: LEAD_SOURCE_BADGE.walk_in,    border: "border-t-purple-500" },
  referral: { badge: LEAD_SOURCE_BADGE.referral,          border: "border-t-pink-500" },
  other: { badge: LEAD_SOURCE_BADGE.other,       border: "border-t-slate-400" },
};

const getInitials = (first?: string | null, last?: string | null, company?: string | null) => {
  const src = company || `${first || ""} ${last || ""}`.trim();
  return src.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join("") || "?";
};

const displayName = (c: any) =>
  c.is_company && c.company_name
    ? c.company_name
    : `${c.first_name || ""} ${c.last_name || ""}`.trim() || c.name || "Unnamed";

const LeadSourceBadge = ({ source }: { source?: string | null }) => {
  const key = toLeadSourceValue(source);
  const style = LEAD_SOURCE_STYLES[key] || LEAD_SOURCE_STYLES.manual;
  return (
    <Badge variant="outline" className={cn("text-xs font-medium", style.badge)}>{leadSourceLabel(source)}</Badge>
  );
};

const AdminCustomersPage = () => {
  const [showCreateLead, setShowCreateLead] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isSalesRep } = useSalesRep();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  // ---- Customers ----
  const { data: customers = [], isLoading, refetch } = useQuery({
    queryKey: ["all-customers-fb", showArchived],
    queryFn: async () => {
      let q = supabase
        .from("customers")
        .select("id, first_name, last_name, name, company_name, is_company, phone, email, primary_address_line1, city, status, notes, lead_source, updated_at, created_at, client_type, payment_terms_basis, payment_terms_days");
      q = showArchived ? q.eq("status", "archived") : q.or("status.is.null,status.neq.archived");
      const { data, error } = await q
        .order("updated_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data || [];
    },
  });

  // ---- Invoices for summary + per-customer outstanding ----
  const { data: invoices = [] } = useQuery({
    queryKey: ["all-invoices-summary"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, customer_id, grand_total, status, due_date, created_at")
        .limit(2000);
      if (error) throw error;
      return data || [];
    },
  });

  const today = new Date().toISOString().slice(0, 10);

  const summary = useMemo(() => {
    let overdue = 0, outstanding = 0;
    for (const i of invoices) {
      const isPaid = i.status === "paid" || i.status === "cancelled";
      if (isPaid) continue;
      outstanding += Number(i.grand_total || 0);
      if (i.status === "overdue" || (i.due_date && i.due_date < today)) {
        overdue += Number(i.grand_total || 0);
      }
    }
    return { overdue, outstanding };
  }, [invoices, today]);

  const outstandingByCustomer = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of invoices) {
      if (!i.customer_id) continue;
      if (i.status === "paid" || i.status === "cancelled") continue;
      m.set(i.customer_id, (m.get(i.customer_id) || 0) + Number(i.grand_total || 0));
    }
    return m;
  }, [invoices]);

  // V8 list (Johan 14:03): stats (sites, last activity) run under the caller's RLS; due data from invoice_due_summary.
  const { data: stats = [] } = useQuery({
    queryKey: ["client-list-stats"],
    queryFn: async () => { const { data, error } = await (supabase as any).rpc("client_list_stats"); if (error) throw error; return (data || []) as { customer_id: string; sites: number; last_activity: string | null }[]; },
  });
  const statBy = useMemo(() => new Map(stats.map((r) => [r.customer_id, r])), [stats]);
  const { data: quotesDue = 0 } = useQuery({ queryKey: ["quotes-followup-due"], queryFn: async () => Number((await (supabase as any).rpc("quotes_followup_due_count")).data || 0) });
  const { rows: dueRows, summary: due } = useInvoiceDue();
  const { hb } = useSalesHeartbeat();
  const dueByCustomer = useMemo(() => {
    const m = new Map<string, { amount: number; overdue: number; maxLate: number; waiting: number }>();
    for (const r of dueRows) { if (!r.customer_id) continue; const e = m.get(r.customer_id) || { amount: 0, overdue: 0, maxLate: 0, waiting: 0 };
      const a = Number(r.amount_due) || 0; e.amount += a;
      if (r.waiting) e.waiting += a; else if (r.days > 0) { e.overdue += a; e.maxLate = Math.max(e.maxLate, r.days); }
      m.set(r.customer_id, e); }
    return m;
  }, [dueRows]);
  const money = useMemo(() => {
    let overdue = 0, overdueN = 0, outstanding = 0, outN = 0, waiting = 0;
    for (const e of dueByCustomer.values()) { outstanding += e.amount; outN++; waiting += e.waiting; if (e.overdue > 0) { overdue += e.overdue; overdueN++; } }
    return dueRows.length ? { overdue, overdueN, outstanding, outN, waiting } : { overdue: summary.overdue, overdueN: 0, outstanding: summary.outstanding, outN: 0, waiting: 0 };
  }, [dueByCustomer, dueRows.length, summary]);
  const topOverdue = useMemo(() => [...dueByCustomer.entries()].filter(([, e]) => e.overdue > 0).sort((a, b) => b[1].maxLate - a[1].maxLate)[0], [dueByCustomer]);
  const [typeF, setTypeF] = useState<string>("all");
  const [sourceF, setSourceF] = useState<string>("all");
  const [overdueOnly, setOverdueOnly] = useState(false);

  const filtered = useMemo(() => {
    let list = customers.filter((c: any) => (typeF === "all" || c.client_type === typeF) && (sourceF === "all" || toLeadSourceValue(c.lead_source) === sourceF) && (!overdueOnly || (dueByCustomer.get(c.id)?.overdue || 0) > 0));
    list = [...list].sort((x: any, y: any) => +new Date(statBy.get(y.id)?.last_activity || y.updated_at || 0) - +new Date(statBy.get(x.id)?.last_activity || x.updated_at || 0));
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(c =>
      displayName(c).toLowerCase().includes(q) ||
      (c.email || "").toLowerCase().includes(q) ||
      (c.phone || "").toLowerCase().includes(q) ||
      (c.primary_address_line1 || "").toLowerCase().includes(q)
    );
  }, [customers, search, typeF, sourceF, overdueOnly, dueByCustomer, statBy]);

  const exportCSV = () => {
    const rows = [
      ["Name", "Company", "Email", "Phone", "City", "Status", "Lead Source", "Outstanding"],
      ...filtered.map(c => [
        displayName(c), c.company_name || "", c.email || "", c.phone || "",
        c.city || "", c.status || "", leadSourceLabel(c.lead_source),
        String(outstandingByCustomer.get(c.id) || 0),
      ]),
    ];
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = `customers-${today}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const ago = (iso?: string | null) => { if (!iso) return "—"; const d = Math.floor((Date.now() - +new Date(iso)) / 864e5); return d <= 0 ? "today" : d === 1 ? "yesterday" : d < 30 ? `${d} days ago` : format(new Date(iso), "dd MMM yyyy"); };
  const fChip = (on: boolean) => cn("shrink-0 rounded-full border px-3 py-1 text-xs font-medium", on ? "border-[#1590D6] bg-[#1590D6] text-white" : "bg-card hover:border-[#1590D6]");
  const newLeads = hb?.hot.length ?? 0;
  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto" data-testid="clients-list-v8">
      <div className="rounded-2xl bg-gradient-to-br from-[#0F2A44] to-[#1590D6] p-4 text-white sm:p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-xl font-semibold sm:text-2xl">Clients <span className="text-sm font-normal text-[#CFE6F6]">{isSalesRep ? `${customers.length} of yours` : `${customers.length} ${showArchived ? "archived" : "active"}`}</span></h1>
          <div className="flex gap-1.5">
            <Button onClick={() => setShowCreate(true)} className="rounded-xl bg-[#F7941D] hover:bg-[#e08310] text-white"><Plus className="h-4 w-4 mr-1" /> New client</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button aria-label="More actions" className="rounded-xl bg-white/15 hover:bg-white/25 text-white px-3">⋯</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => toast({ title: "Import coming soon" })}><Upload className="h-4 w-4 mr-2" /> Import Customers</DropdownMenuItem>
                <DropdownMenuItem onClick={exportCSV}><Download className="h-4 w-4 mr-2" /> Export CSV</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setShowCreateLead(true)}>New lead</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="relative mt-3">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search name, phone, email, address…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-10 rounded-xl border-0 bg-white pl-9 text-[#0F2A44]" data-testid="clients-search" />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => navigate(TILE_LINKS.overdueInvoices)} className="min-w-0 rounded-xl border border-white/25 px-3 py-2 text-left hover:bg-white/10">
            <span className="block truncate text-xs text-[#CFE6F6]">Overdue{money.overdueN ? ` · ${money.overdueN} client${money.overdueN === 1 ? "" : "s"}` : ""}</span>
            <span className={cn("block truncate text-lg font-semibold", money.overdue > 0 && "text-[#FFB4B6]")}>{randShort(money.overdue)}</span>
          </button>
          <button type="button" onClick={() => navigate("/admin/invoices?state=unpaid")} className="min-w-0 rounded-xl border border-white/25 px-3 py-2 text-left hover:bg-white/10">
            <span className="block truncate text-xs text-[#CFE6F6]">Outstanding{money.outN ? ` · ${money.outN} client${money.outN === 1 ? "" : "s"}` : ""}</span>
            <span className="block truncate text-lg font-semibold">{randShort(money.outstanding)}</span>
            {money.waiting > 0 && <span className="block truncate text-[11px] text-[#CFE6F6]">{randShort(money.waiting)} waiting for job completion</span>}
          </button>
        </div>
      </div>

      {(money.overdueN > 0 || quotesDue > 0 || newLeads > 0) && (
        <div>
          <p className="mb-1.5 text-sm font-semibold">Needs attention</p>
          <div className="flex gap-2 overflow-x-auto pb-1" data-testid="needs-attention">
            {money.overdueN > 0 && <AttCard tone="red" chip={`${money.overdueN} overdue`} text={topOverdue ? `${displayName(customers.find((c) => c.id === topOverdue[0]) || {} as any)} · ${topOverdue[1].maxLate}d late` : "clients owe money"} onClick={() => setOverdueOnly(true)} />}
            {quotesDue > 0 && <AttCard tone="amber" chip={`${quotesDue} quote${quotesDue === 1 ? "" : "s"}`} text="follow-up call due" onClick={() => navigate("/admin/quotes")} />}
            {newLeads > 0 && <AttCard tone="sky" chip={`${newLeads} new lead${newLeads === 1 ? "" : "s"}`} text="not contacted yet" onClick={() => navigate("/admin/leads")} />}
          </div>
        </div>
      )}

      <Card className="rounded-2xl"><CardContent className="p-4">
        <div className="flex gap-1.5 flex-wrap">
          {[["all", "All"], ["private", "Private"], ["company", "Company"], ["developer", "Developer"]].map(([v, l]) => <button key={v} type="button" className={fChip(typeF === v)} onClick={() => setTypeF(v)}>{l}</button>)}
          <DropdownMenu>
            <DropdownMenuTrigger asChild><button type="button" className={fChip(sourceF !== "all")}>{sourceF === "all" ? "Source" : leadSourceLabel(sourceF)} <ChevronDown className="inline h-3 w-3" /></button></DropdownMenuTrigger>
            <DropdownMenuContent><DropdownMenuItem onClick={() => setSourceF("all")}>All sources</DropdownMenuItem>{LEAD_SOURCE_OPTIONS.map((o) => <DropdownMenuItem key={o.value} onClick={() => setSourceF(o.value)}>{o.label}</DropdownMenuItem>)}</DropdownMenuContent>
          </DropdownMenu>
          <button type="button" className={fChip(overdueOnly)} onClick={() => setOverdueOnly((v) => !v)}>Has overdue</button>
          <button type="button" className={fChip(showArchived)} onClick={() => setShowArchived((v) => !v)}>Archived</button>
        </div>
        {isLoading ? <div className="mt-3 space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div> : (
          <div className="mt-2">
            <div className="hidden md:grid grid-cols-[2.2fr_1fr_.6fr_1.2fr_1.2fr_32px] gap-2 py-2 text-xs text-muted-foreground"><span>Client</span><span>Source</span><span>Sites</span><span>Outstanding</span><span>Last activity</span><span /></div>
            {filtered.map((c: any) => {
              const d = dueByCustomer.get(c.id); const st = statBy.get(c.id);
              const out = d ? d.amount : (outstandingByCustomer.get(c.id) || 0);
              const sub = [c.is_company && `${c.first_name || ""} ${c.last_name || ""}`.trim(), c.client_type && String(c.client_type).replace(/^./, (x: string) => x.toUpperCase()), c.city].filter(Boolean).join(" · ");
              return (
                <div key={c.id} role="link" tabIndex={0} onClick={() => navigate(`/admin/customers/${c.id}`)} onKeyDown={(e) => e.key === "Enter" && navigate(`/admin/customers/${c.id}`)}
                  className="grid cursor-pointer grid-cols-[1fr_auto] md:grid-cols-[2.2fr_1fr_.6fr_1.2fr_1.2fr_32px] items-center gap-2 border-t py-2.5 text-sm hover:bg-muted/40">
                  <div className="min-w-0"><p className="font-semibold truncate">{displayName(c)}</p>{sub && <p className="text-xs text-muted-foreground truncate">{sub}</p>}</div>
                  <div className="hidden md:block"><LeadSourceBadge source={c.lead_source} /></div>
                  <div className="hidden md:block text-muted-foreground">{st?.sites ?? 0}</div>
                  <div className="flex items-center justify-end md:justify-start gap-1.5 whitespace-nowrap">
                    <span className={cn(out > 0 ? "font-semibold" : "text-muted-foreground")}>{randShort(out)}</span>
                    {d && d.overdue > 0 ? <span className="rounded-full bg-[#FDECEC] px-2 text-[11px] font-semibold text-[#C9373C] dark:bg-red-500/15 dark:text-red-300">{d.maxLate}d</span>
                      : d && d.waiting > 0 ? <span className="rounded-full bg-[#E8F6FE] px-2 text-[11px] font-semibold text-[#1590D6] dark:bg-sky-500/15 dark:text-sky-300">after completion</span> : null}
                  </div>
                  <div className="hidden md:block text-xs text-muted-foreground">{ago(st?.last_activity || c.updated_at)}</div>
                  <div className="hidden md:block" onClick={(e) => e.stopPropagation()}>
                    <RowMenu items={[
                      { label: "Open", onSelect: () => navigate(`/admin/customers/${c.id}`) },
                      { label: "New lead", onSelect: () => setShowCreateLead(true) },
                      { label: "New quote", onSelect: () => navigate(`/admin/quote-builder?customerId=${c.id}`) },
                      { label: "Edit", onSelect: () => navigate(`/admin/customers/${c.id}`) },
                    ]} />
                  </div>
                </div>);
            })}
            {filtered.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No clients match.</p>}
          </div>)}
      </CardContent></Card>

      <CreateLeadDialog open={showCreateLead} onOpenChange={setShowCreateLead} />

      <CreateCustomerFBDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        userId={user?.id}
        onCreated={(id) => { refetch(); navigate(`/admin/customers/${id}`); }}
      />
    </div>
  );
};

const ATT_TONE = { red: "bg-[#FDECEC] text-[#C9373C] dark:bg-red-500/15 dark:text-red-300", amber: "bg-[#FFF4E0] text-[#B5730A] dark:bg-amber-500/15 dark:text-amber-300", sky: "bg-[#E8F6FE] text-[#1590D6] dark:bg-sky-500/15 dark:text-sky-300" } as const;
const AttCard = ({ tone, chip, text, onClick }: { tone: keyof typeof ATT_TONE; chip: string; text: string; onClick: () => void }) => (
  <button type="button" onClick={onClick} className="min-w-[160px] flex-1 rounded-2xl border bg-card p-3 text-left hover:border-[#1590D6]">
    <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", ATT_TONE[tone])}>{chip}</span>
    <p className="mt-1.5 text-sm break-words">{text}</p>
  </button>
);

const SummaryCard = ({ label, amount, accent, onClick }: { label: string; amount: number; accent?: boolean; onClick?: () => void }) => (
  <Card role={onClick ? "link" : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick}
    onKeyDown={(e) => { if (onClick && e.key === "Enter") onClick(); }}
    className={cn(onClick && "cursor-pointer hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    "border-none text-white overflow-hidden",
    accent
      ? "bg-gradient-to-br from-[#0066CC] to-[#004999]"
      : "bg-gradient-to-br from-[#0077DD] to-[#0066CC]",
  )}>
    <CardContent className="p-5">
      <p className="text-xs uppercase tracking-wide text-white/80">{label}</p>
      <p className="kpi-fluid [--kpi-max:2.5rem] tabular-nums text-3xl font-bold mt-2">{formatRand(amount)}</p>
    </CardContent>
  </Card>
);

// ---------- Create Customer Dialog (FreshBooks-style, with lead_source) ----------
const CreateCustomerFBDialog = ({
  open, onOpenChange, userId, onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  userId?: string;
  onCreated: (id: string) => void;
}) => {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    first_name: "", last_name: "", company_name: "",
    email: "", phone: "", address: "", city: "", postal_code: "",
    vat_number: "", notes: "",
    status: "lead",
    lead_source: DEFAULT_LEAD_SOURCE as string,
  });

  const set = (k: keyof typeof form, v: string) => setForm(p => ({ ...p, [k]: v }));

  const reset = () => setForm({
    first_name: "", last_name: "", company_name: "", email: "", phone: "",
    address: "", city: "", postal_code: "", vat_number: "", notes: "",
    status: "lead", lead_source: DEFAULT_LEAD_SOURCE as string,
  });

  const save = async () => {
    if (!form.first_name || !form.phone) {
      toast({ title: "Missing fields", description: "First name and phone are required.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const { getUserCompanyId } = await import("@/lib/tenantUtils");
      const company_id = await getUserCompanyId(userId);
      const payload = {
          first_name: form.first_name,
          last_name: form.last_name,
          name: `${form.first_name} ${form.last_name}`.trim(),
          company_name: form.company_name || null,
          is_company: !!form.company_name,
          email: form.email || null,
          phone: form.phone,
          primary_address_line1: form.address || null,
          address: [form.address, form.city, form.postal_code].filter(Boolean).join(", "),
          city: form.city || null,
          postal_code: form.postal_code || null,
          vat_number: form.vat_number || null,
          notes: form.notes || null,
          status: form.status,
        lead_source: toLeadSourceValue(form.lead_source),
        company_id,
      };

      let { data, error } = await supabase.from("customers").insert(payload).select("id").single();

      // Never hard-fail the whole save because of an unexpected lead source value.
      if (error && /lead_source/i.test(error.message || "")) {
        ({ data, error } = await supabase
          .from("customers")
          .insert({ ...payload, lead_source: "other" })
          .select("id")
          .single());
      }
      if (error) throw error;
      toast({ title: "Customer created ✅" });
      reset();
      onOpenChange(false);
      onCreated(data.id);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Customer</DialogTitle>
          <DialogDescription>Add a new client to your database.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <Field label="First Name *"><Input value={form.first_name} onChange={e => set("first_name", e.target.value)} /></Field>
          <Field label="Last Name"><Input value={form.last_name} onChange={e => set("last_name", e.target.value)} /></Field>
          <Field label="Company Name" full><Input value={form.company_name} onChange={e => set("company_name", e.target.value)} /></Field>
          <Field label="Email"><Input type="email" value={form.email} onChange={e => set("email", e.target.value)} /></Field>
          <Field label="Phone *"><Input value={form.phone} onChange={e => set("phone", e.target.value)} placeholder="082 123 4567" /></Field>
          <Field label="Address" full><Input value={form.address} onChange={e => set("address", e.target.value)} /></Field>
          <Field label="City"><Input value={form.city} onChange={e => set("city", e.target.value)} /></Field>
          <Field label="Postal Code"><Input value={form.postal_code} onChange={e => set("postal_code", e.target.value)} /></Field>
          <Field label="VAT Number" full><Input value={form.vat_number} onChange={e => set("vat_number", e.target.value)} /></Field>

          <Field label="Status">
            <Select value={form.status} onValueChange={(v) => set("status", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="lead">Lead</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Lead Source">
            <Select value={form.lead_source} onValueChange={(v) => set("lead_source", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {LEAD_SOURCE_OPTIONS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Notes" full>
            <Textarea value={form.notes} onChange={e => set("notes", e.target.value)} rows={3} />
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="brand" onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Customer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const Field = ({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) => (
  <div className={cn("space-y-1.5", full && "col-span-2")}>
    <Label className="text-xs">{label}</Label>
    {children}
  </div>
);

export default AdminCustomersPage;
