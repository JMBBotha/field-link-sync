import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
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

const LEAD_SOURCE_STYLES: Record<string, { badge: string; border: string }> = {
  manual:        { badge: "bg-slate-100 text-slate-700 border-slate-200",       border: "border-t-slate-400" },
  facebook_lead: { badge: "bg-blue-100 text-blue-700 border-blue-200",          border: "border-t-blue-500" },
  website_form:  { badge: "bg-green-100 text-green-700 border-green-200",       border: "border-t-green-500" },
  website:       { badge: "bg-green-100 text-green-700 border-green-200",       border: "border-t-green-500" },
  whatsapp:      { badge: "bg-emerald-100 text-emerald-700 border-emerald-200", border: "border-t-emerald-500" },
  phone_call:    { badge: "bg-orange-100 text-orange-700 border-orange-200",    border: "border-t-orange-500" },
  vapi:          { badge: "bg-orange-100 text-orange-700 border-orange-200",    border: "border-t-orange-500" },
  walk_in:       { badge: "bg-purple-100 text-purple-700 border-purple-200",    border: "border-t-purple-500" },
  referral:      { badge: "bg-pink-100 text-pink-700 border-pink-200",          border: "border-t-pink-500" },
  other:         { badge: "bg-slate-100 text-slate-700 border-slate-200",       border: "border-t-slate-400" },
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
    <Badge variant="outline" className={cn("text-[10px] font-medium", style.badge)}>{leadSourceLabel(source)}</Badge>
  );
};

const AdminCustomersPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  // ---- Customers ----
  const { data: customers = [], isLoading, refetch } = useQuery({
    queryKey: ["all-customers-fb"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, first_name, last_name, name, company_name, is_company, phone, email, primary_address_line1, city, status, notes, lead_source, updated_at, created_at")
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

  // ---- Draft quotes total ----
  const { data: draftQuotes = [] } = useQuery({
    queryKey: ["draft-quotes-summary"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quotes")
        .select("id, total, status")
        .eq("status", "draft")
        .neq("status", "superseded")
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
    const draft = draftQuotes.reduce((s, q) => s + Number(q.total || 0), 0);
    return { overdue, outstanding, draft };
  }, [invoices, draftQuotes, today]);

  const outstandingByCustomer = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of invoices) {
      if (!i.customer_id) continue;
      if (i.status === "paid" || i.status === "cancelled") continue;
      m.set(i.customer_id, (m.get(i.customer_id) || 0) + Number(i.grand_total || 0));
    }
    return m;
  }, [invoices]);

  const recent = useMemo(() => customers.slice(0, 4), [customers]);

  const filtered = useMemo(() => {
    if (!search.trim()) return customers;
    const q = search.toLowerCase();
    return customers.filter(c =>
      displayName(c).toLowerCase().includes(q) ||
      (c.email || "").toLowerCase().includes(q) ||
      (c.phone || "").toLowerCase().includes(q) ||
      (c.primary_address_line1 || "").toLowerCase().includes(q)
    );
  }, [customers, search]);

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

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Clients</h1>
          <p className="text-sm text-muted-foreground">{customers.length} customers in database</p>
        </div>
        <div className="flex gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                More Actions <ChevronDown className="h-4 w-4 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => toast({ title: "Import coming soon" })}>
                <Upload className="h-4 w-4 mr-2" /> Import Customers
              </DropdownMenuItem>
              <DropdownMenuItem onClick={exportCSV}>
                <Download className="h-4 w-4 mr-2" /> Export CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="brand" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1" /> New Customer
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SummaryCard label="Overdue" amount={summary.overdue} accent />
        <SummaryCard label="Total Outstanding" amount={summary.outstanding} />
        <SummaryCard label="In Draft" amount={summary.draft} />
      </div>

      {/* Recently Active */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Recently Active</h2>
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[0,1,2,3].map(i => <Skeleton key={i} className="h-40" />)}
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
            {recent.map(c => {
              const style = LEAD_SOURCE_STYLES[toLeadSourceValue(c.lead_source)] || LEAD_SOURCE_STYLES.manual;
              return (
                <Card
                  key={c.id}
                  onClick={() => navigate(`/admin/customers/${c.id}`)}
                  className={cn(
                    "min-w-[260px] flex-shrink-0 cursor-pointer hover:shadow-md transition-all border-t-4 bg-card",
                    style.border,
                  )}
                >
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start gap-3">
                      <Avatar className="h-10 w-10">
                        <AvatarFallback className="bg-[#0066CC]/10 text-primary font-semibold text-sm">
                          {getInitials(c.first_name, c.last_name, c.company_name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate">{displayName(c)}</p>
                        {c.company_name && !c.is_company && (
                          <p className="text-xs text-muted-foreground truncate">{c.company_name}</p>
                        )}
                      </div>
                    </div>
                    <div className="space-y-1 text-xs text-muted-foreground">
                      {c.email && (
                        <div className="flex items-center gap-1.5 truncate">
                          <Mail className="h-3 w-3 shrink-0" /><span className="truncate">{c.email}</span>
                        </div>
                      )}
                      {c.phone && (
                        <div className="flex items-center gap-1.5">
                          <Phone className="h-3 w-3 shrink-0" /><span>{c.phone}</span>
                        </div>
                      )}
                    </div>
                    <LeadSourceBadge source={c.lead_source} />
                  </CardContent>
                </Card>
              );
            })}
            {recent.length === 0 && (
              <p className="text-sm text-muted-foreground">No customers yet.</p>
            )}
          </div>
        )}
      </div>

      {/* All Clients */}
      <Card className="bg-card">
        <CardContent className="p-0">
          <Tabs defaultValue="clients">
            <div className="flex items-center justify-between gap-3 px-4 pt-4 flex-wrap">
              <TabsList>
                <TabsTrigger value="clients">Clients</TabsTrigger>
                <TabsTrigger value="emails">Sent Emails</TabsTrigger>
              </TabsList>
              <div className="flex gap-2 flex-1 min-w-[240px] max-w-md ml-auto">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search clients..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-8"
                  />
                </div>
                <Button variant="outline">Advanced Search</Button>
              </div>
            </div>

            <TabsContent value="clients" className="p-0 mt-4">
              {isLoading ? (
                <div className="p-4 space-y-2">
                  {[0,1,2,3,4].map(i => <Skeleton key={i} className="h-12" />)}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10"><Checkbox /></TableHead>
                        <TableHead>Client Name / Primary Contact</TableHead>
                        <TableHead>Internal Note</TableHead>
                        <TableHead className="text-right">Credit</TableHead>
                        <TableHead className="text-right">Total Outstanding</TableHead>
                        <TableHead>Lead Source</TableHead>
                        <TableHead className="w-10"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.map(c => {
                        const out = outstandingByCustomer.get(c.id) || 0;
                        return (
                          <TableRow
                            key={c.id}
                            className="cursor-pointer"
                            onClick={() => navigate(`/admin/customers/${c.id}`)}
                          >
                            <TableCell onClick={(e) => e.stopPropagation()}><Checkbox /></TableCell>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <Avatar className="h-8 w-8">
                                  <AvatarFallback className="bg-[#0066CC]/10 text-primary text-xs font-semibold">
                                    {getInitials(c.first_name, c.last_name, c.company_name)}
                                  </AvatarFallback>
                                </Avatar>
                                <div>
                                  <p className="font-medium text-sm">{displayName(c)}</p>
                                  {c.email && <p className="text-xs text-muted-foreground">{c.email}</p>}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="max-w-[220px] text-xs text-muted-foreground truncate">
                              {c.notes || "—"}
                            </TableCell>
                            <TableCell className="text-right text-sm text-muted-foreground">R 0</TableCell>
                            <TableCell className={cn("text-right text-sm font-medium", out > 0 ? "text-rose-600" : "text-muted-foreground")}>
                              {formatRand(out)}
                            </TableCell>
                            <TableCell><LeadSourceBadge source={c.lead_source} /></TableCell>
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {filtered.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                            No customers match your search.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="emails" className="p-8 text-center text-sm text-muted-foreground">
              Sent emails will appear here.
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <CreateCustomerFBDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        userId={user?.id}
        onCreated={(id) => { refetch(); navigate(`/admin/customers/${id}`); }}
      />
    </div>
  );
};

const SummaryCard = ({ label, amount, accent }: { label: string; amount: number; accent?: boolean }) => (
  <Card className={cn(
    "border-none text-white overflow-hidden",
    accent
      ? "bg-gradient-to-br from-[#0066CC] to-[#004999]"
      : "bg-gradient-to-br from-[#0077DD] to-[#0066CC]",
  )}>
    <CardContent className="p-5">
      <p className="text-xs uppercase tracking-wide text-white/80">{label}</p>
      <p className="text-3xl font-bold mt-2">{formatRand(amount)}</p>
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
      const { data, error } = await supabase
        .from("customers")
        .insert({
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
        })
        .select("id")
        .single();
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
