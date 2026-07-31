import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronRight, Briefcase, Send, Loader2, X } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { format } from "date-fns";
import { toast } from "sonner";


export interface QuoteQuickAction {
  id: string;
  quoteNumber: string | null;
  total: number;
  customerId: string | null;
  companyId: string | null;
  clientName: string;
  email: string | null;
  address: string | null;
}

export interface PreviewRow {
  id: string;
  primary: string;
  secondary: string;
  badge?: string;
  value?: string;
  href: string;
  quote?: QuoteQuickAction;
}


async function fetchPreview(kpiKey: string, today: string): Promise<PreviewRow[]> {
  const leadHref = (l: { id: string; customer_id?: string | null }) =>
    l.customer_id ? `/admin/customers/${l.customer_id}` : `/admin/dispatch`;

  switch (kpiKey) {
    case "new_leads":
    case "active_jobs": {
      const query = supabase
        .from("leads")
        .select("id, customer_name, customer_address, service_type, status, customer_id, created_at, customer_phone");
      const { data } =
        kpiKey === "new_leads"
          ? await query
              .gte("created_at", today + "T00:00:00")
              .eq("status", "pending")
              .order("created_at", { ascending: false })
              .limit(5)
          : await query.in("status", ["accepted", "en_route", "on_site"]).limit(5);

      return (data || []).map((l: any) => ({
        id: l.id,
        primary: l.customer_name || "Unknown",
        secondary: [l.service_type, l.customer_phone, l.customer_address].filter(Boolean).join(" • "),
        badge: (l.status || "").replace(/_/g, " "),
        href: leadHref(l),
      }));
    }
    case "pending_quotes": {
      const { data } = await supabase
        .from("quotes")
        .select("id, quote_number, total, created_at, customer_id, company_id, customer_name, customers(name, email, address)")
        .eq("status", "draft")
        .order("created_at", { ascending: false })
        .limit(5);
      return (data || []).map((q: any) => ({
        id: q.id,
        primary: q.customers?.name || q.customer_name || q.quote_number,
        secondary: `${q.quote_number} • ${q.created_at ? format(new Date(q.created_at), "dd MMM HH:mm") : ""}`,
        value: `R ${Number(q.total || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`,
        href: `/admin/estimates/${q.id}`,
        quote: {
          id: q.id,
          quoteNumber: q.quote_number,
          total: Number(q.total || 0),
          customerId: q.customer_id,
          companyId: q.company_id,
          clientName: q.customers?.name || q.customer_name || "",
          email: q.customers?.email || null,
          address: q.customers?.address || null,
        },
      }));
    }

    case "overdue_invoices": {
      const { data } = await supabase
        .from("invoices")
        .select("id, invoice_number, customer_name, grand_total, due_date, customer_id")
        .eq("status", "overdue")
        .order("due_date", { ascending: true })
        .limit(5);
      return (data || []).map((inv: any) => ({
        id: inv.id,
        primary: inv.customer_name || inv.invoice_number,
        secondary: `${inv.invoice_number} • Due ${inv.due_date ? format(new Date(inv.due_date), "dd MMM") : "N/A"}`,
        value: `R ${Number(inv.grand_total || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`,
        badge: "overdue",
        href: `/admin/invoices/${inv.id}`,
      }));
    }
    case "active_techs": {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, availability_status, phone")
        .limit(5);
      return (data || []).map((p: any) => ({
        id: p.id,
        primary: p.full_name || "Unnamed technician",
        secondary: [p.phone, p.availability_status].filter(Boolean).join(" • "),
        badge: p.availability_status || undefined,
        href: "/admin/team",
      }));
    }
    default:
      return [];
  }
}

interface Props {
  kpiKey: string;
  label: string;
  viewAllHref: string;
  children: React.ReactNode;
}

/**
 * Hover preview for the dashboard KPI cards — shows the first few underlying
 * records with basic info; clicking a row navigates to that client/record.
 */
const KpiHoverPreview = ({ kpiKey, label, viewAllHref, children }: Props) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const isMobile = useIsMobile();

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const today = new Date().toISOString().split("T")[0];

  const { data, isLoading } = useQuery({
    queryKey: ["kpi-preview", kpiKey, today],
    queryFn: () => fetchPreview(kpiKey, today),
    enabled: open,
    staleTime: 30000,
  });

  const convertToJob = async (q: QuoteQuickAction) => {
    setBusy(`job-${q.id}`);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user) throw new Error("You must be signed in");

      // Don't duplicate an existing job for this quote
      const { data: existing } = await supabase
        .from("jobs")
        .select("id")
        .eq("quote_id", q.id)
        .maybeSingle();
      if (existing?.id) {
        toast.info("A job already exists for this quote");
        setOpen(false);
        navigate(`/admin/jobs`);
        return;
      }

      let companyId = q.companyId;
      if (!companyId) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("company_id")
          .eq("id", user.id)
          .maybeSingle();
        companyId = (profile as any)?.company_id ?? null;
      }
      if (!companyId) throw new Error("No company found for this quote");

      const { error } = await supabase.from("jobs").insert({
        company_id: companyId,
        title: `Job for ${q.quoteNumber || "quote"}${q.clientName ? ` — ${q.clientName}` : ""}`,
        description: `Created from quote ${q.quoteNumber || q.id}`,
        customer_id: q.customerId,
        quote_id: q.id,
        address: q.address,
        status: "scheduled",
        priority: "normal",
        created_by: user.id,
      } as any);
      if (error) throw error;

      toast.success("Job created from quote");
      queryClient.invalidateQueries({ queryKey: ["kpi-preview"] });
      setOpen(false);
      navigate("/admin/jobs");
    } catch (err: any) {
      toast.error(err?.message || "Could not convert quote to job");
    } finally {
      setBusy(null);
    }
  };

  const sendQuote = async (q: QuoteQuickAction) => {
    if (!q.email) {
      toast.error("This customer has no email address on file");
      return;
    }
    setBusy(`send-${q.id}`);
    try {
      const { error } = await supabase.functions.invoke("send-quote-email", {
        body: {
          to: q.email,
          subject: `Your 0800BeCool Quote ${q.quoteNumber || ""}`.trim(),
          quoteNumber: q.quoteNumber,
          clientName: q.clientName,
          totalAmount: q.total,
          unsubscribeToken: crypto.randomUUID(),
        },
      });
      if (error) throw error;

      await supabase
        .from("quotes")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", q.id);

      toast.success(`Quote sent to ${q.email}`);
      queryClient.invalidateQueries({ queryKey: ["kpi-preview"] });
    } catch (err: any) {
      toast.error(err?.message || "Failed to send quote");
    } finally {
      setBusy(null);
    }
  };

  const panel = (
    <>
        <div className="px-3 py-2 border-b bg-muted/40 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold truncate">{label}</p>
            <p className="text-[11px] text-muted-foreground">
              {isMobile ? "Tap an item to open its record" : "Click an item to open its record"}
            </p>
          </div>
          {isMobile && (
            <button
              type="button"
              aria-label="Close preview"
              onClick={() => setOpen(false)}
              className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>


        <div className="max-h-72 overflow-y-auto divide-y">
          {isLoading ? (
            <div className="p-3 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded" />
              ))}
            </div>
          ) : !data || data.length === 0 ? (
            <p className="p-4 text-xs text-muted-foreground text-center">Nothing to show right now</p>
          ) : (
            data.map((row) => (
              <div key={row.id} className="hover:bg-muted/60 transition-colors">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    navigate(row.href);
                  }}
                  className="w-full text-left px-3 py-2 flex items-center gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{row.primary}</p>
                    <p className="text-[11px] text-muted-foreground truncate">{row.secondary}</p>
                  </div>
                  {row.value && <span className="text-[11px] font-mono tabular-nums shrink-0">{row.value}</span>}
                  {row.badge && (
                    <Badge variant="secondary" className="shrink-0 text-[10px] capitalize">
                      {row.badge}
                    </Badge>
                  )}
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                </button>

                {row.quote && (
                  <div className="flex gap-1.5 px-3 pb-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[11px] flex-1"
                      disabled={busy === `job-${row.quote.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        convertToJob(row.quote!);
                      }}
                    >
                      {busy === `job-${row.quote.id}` ? (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      ) : (
                        <Briefcase className="h-3 w-3 mr-1" />
                      )}
                      Convert to job
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[11px] flex-1"
                      disabled={busy === `send-${row.quote.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        sendQuote(row.quote!);
                      }}
                    >
                      {busy === `send-${row.quote.id}` ? (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      ) : (
                        <Send className="h-3 w-3 mr-1" />
                      )}
                      Send
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>


        <button
          type="button"
          onClick={() => {
            setOpen(false);
            navigate(viewAllHref);
          }}
          className="w-full px-3 py-2 text-xs font-medium text-primary hover:bg-muted/60 border-t text-left"
        >
          View all →
        </button>
    </>
  );

  if (isMobile) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <div
            onClickCapture={(e) => {
              // Tap toggles the preview instead of triggering the card's own click
              e.preventDefault();
              e.stopPropagation();
              setOpen((o) => !o);
            }}
          >
            {children}
          </div>
        </PopoverTrigger>
        <PopoverContent
          align="center"
          sideOffset={8}
          className="w-[calc(100vw-2rem)] max-w-sm p-0 overflow-hidden"
        >
          {panel}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={150} closeDelay={120}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent align="start" className="w-80 p-0 overflow-hidden">
        {panel}
      </HoverCardContent>
    </HoverCard>
  );

};

export default KpiHoverPreview;
