import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Search, FileText, Download, Link2, FileCheck2, ChevronDown, FileSignature, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Spinner } from "@/components/ui/spinner";
import { ListSkeleton } from "@/components/ui/skeletons";
import { convertQuoteToInvoice } from "@/lib/convertQuoteToInvoice";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
import StatusPill from "@/components/shared/StatusPill";

import { useToast } from "@/hooks/use-toast";
import WhatsAppShareButton from "@/components/WhatsAppShareButton";
import HelpTip from "@/components/help/HelpTip";

const formatZAR = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

interface QuotesListProps {
  onCreateNew: () => void;
  onEditQuote: (id: string) => void;
}

const QuotesList = ({ onCreateNew, onEditQuote }: QuotesListProps) => {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "estimate" | "proposal">("all");
  const [converting, setConverting] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<any[] | null>(null);
  const { toast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const handleConvertToInvoice = async (quoteId: string) => {
    if (!user?.id) return;
    setConverting(quoteId);

    // Optimistic: flip status → accepted immediately in every ["quotes", ...] cache.
    const affected = qc.getQueriesData<any[]>({ queryKey: ["quotes"] });
    const snapshots = affected.map(([k, v]) => [k, v] as const);
    affected.forEach(([k, list]) => {
      if (!Array.isArray(list)) return;
      qc.setQueryData(
        k,
        list.map((q: any) => (q.id === quoteId ? { ...q, status: "accepted" } : q)),
      );
    });

    try {
      const invoiceId = await convertQuoteToInvoice(quoteId, user.id);
      toast({ title: "Invoice created", description: "Draft invoice generated from quote." });
      qc.invalidateQueries({ queryKey: ["quotes"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      navigate(`/admin/invoices?highlight=${invoiceId}`);
    } catch (e: any) {
      // Rollback
      snapshots.forEach(([k, v]) => qc.setQueryData(k, v));
      toast({
        title: e.message || "Conversion failed",
        description: "Reverted the quote. Please try again.",
        variant: "destructive",
      });
    } finally {
      setConverting(null);
    }
  };

  const { data: quotes = [], isLoading } = useQuery({
    queryKey: ["quotes", search, statusFilter],
    queryFn: async () => {
      let query = supabase
        .from("quotes")
        .select("*, customers(name, phone)")
        .neq("status", "superseded")
        .order("created_at", { ascending: false });

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }
      if (search) {
        query = query.or(`quote_number.ilike.%${search}%,notes.ilike.%${search}%`);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
  });

  const { data: proposals = [] } = useQuery({
    queryKey: ["visual-proposals", search, statusFilter],
    queryFn: async () => {
      let query = (supabase as any)
        .from("visual_proposals")
        .select("*, customers:client_id(name, phone)")
        .order("created_at", { ascending: false });
      if (statusFilter !== "all") query = query.eq("status", statusFilter);
      if (search) query = query.ilike("title", `%${search}%`);
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });

  const statuses = ["all", "draft", "sent", "viewed", "accepted", "declined"];

  // Combined document feed — estimates + proposals in one list.
  const docs = [
    ...(quotes as any[]).map((q) => ({
      kind: "estimate" as const,
      id: q.id,
      ref: q.quote_number,
      clientName: q.customers?.name,
      clientPhone: q.customers?.phone,
      status: q.status,
      created_at: q.created_at,
      total: Number(q.total || 0),
      raw: q,
    })),
    ...(proposals as any[]).map((p) => ({
      kind: "proposal" as const,
      id: p.id,
      ref: p.title,
      clientName: p.customers?.name,
      clientPhone: p.customers?.phone,
      status: p.status,
      created_at: p.created_at,
      total: Number(p.total || 0),
      raw: p,
    })),
  ]
    .filter((d) => (typeFilter === "all" ? true : d.kind === typeFilter))
    .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));

  const statCards = [
    { key: "draft", label: "Draft" },
    { key: "sent", label: "Sent" },
    { key: "accepted", label: "Accepted" },
    { key: "declined", label: "Declined" },
  ].map((s) => {
    const rows = docs.filter((d) => d.status === s.key);
    return {
      ...s,
      count: rows.length,
      total: rows.reduce((sum, d) => sum + d.total, 0),
    };
  });

  const allSelected = docs.length > 0 && selected.length === docs.length;
  const toggleAll = () => setSelected(allSelected ? [] : docs.map((d) => d.id));
  const toggleOne = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  // Only draft documents may be deleted.
  const draftDocs = docs.filter((d) => d.status === "draft");
  const selectedDrafts = draftDocs.filter((d) => selected.includes(d.id));

  const performDelete = async (targets: typeof docs) => {
    setDeleting(true);
    try {
      const estimateIds = targets.filter((d) => d.kind === "estimate").map((d) => d.id);
      const proposalIds = targets.filter((d) => d.kind === "proposal").map((d) => d.id);

      if (estimateIds.length) {
        // Delete the parent FIRST so a permission failure can never orphan/wipe
        // the children. `.select()` tells us which rows were actually removed —
        // an RLS-filtered delete returns no error and no rows.
        let { data: removed, error } = await supabase
          .from("quotes")
          .delete()
          .in("id", estimateIds)
          .eq("status", "draft")
          .select("id");

        // Restrict-only FKs: clear/detach children, then retry the parent.
        if (error && (error as any).code === "23503") {
          // Block deletion when the draft has already produced billing records.
          const { data: linkedInvoices } = await supabase
            .from("invoices")
            .select("id")
            .in("quote_id", estimateIds)
            .limit(1);
          if (linkedInvoices && linkedInvoices.length > 0) {
            throw new Error(
              "This draft has an invoice linked to it. Delete or unlink the invoice first.",
            );
          }
          await supabase.from("quote_items").delete().in("quote_id", estimateIds);
          await supabase.from("quote_line_items").delete().in("quote_id", estimateIds);
          await supabase.from("quote_areas").delete().in("quote_id", estimateIds);
          // Jobs reference quotes with NO ACTION — detach them instead of deleting.
          await supabase.from("jobs").update({ quote_id: null }).in("quote_id", estimateIds);
          ({ data: removed, error } = await supabase
            .from("quotes")
            .delete()
            .in("id", estimateIds)
            .eq("status", "draft")
            .select("id"));
        }
        if (error) throw error;
        if (!removed || removed.length === 0) {
          throw new Error(
            "You do not have permission to delete these drafts. Ask an administrator.",
          );
        }

      }
      if (proposalIds.length) {
        const { data: removed, error } = await (supabase as any)
          .from("visual_proposals")
          .delete()
          .in("id", proposalIds)
          .eq("status", "draft")
          .select("id");
        if (error) throw error;
        if (!removed || removed.length === 0) {
          throw new Error(
            "You do not have permission to delete these drafts. Ask an administrator.",
          );
        }
      }

      setSelected((prev) => prev.filter((id) => !targets.some((t) => t.id === id)));
      qc.invalidateQueries({ queryKey: ["quotes"] });
      qc.invalidateQueries({ queryKey: ["visual-proposals"] });
      toast({
        title: `${targets.length} draft${targets.length !== 1 ? "s" : ""} deleted`,
      });
    } catch (e: any) {
      qc.invalidateQueries({ queryKey: ["quotes"] });
      qc.invalidateQueries({ queryKey: ["visual-proposals"] });
      toast({
        title: "Delete failed",
        description: e.message || "Could not delete the selected drafts.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };


  const openDoc = (doc: (typeof docs)[number]) => {
    if (doc.kind === "proposal") navigate(`/admin/proposal-builder?proposalId=${doc.id}`);
    else navigate(`/admin/estimates/${doc.id}`);
  };

  return (
    <div className="min-h-full bg-background">
      {/* Page header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            Estimates and Proposals
            <HelpTip title="Estimates and Proposals" side="bottom">
              An <strong>Estimate</strong> is a simple list of services and costs. A{" "}
              <strong>Proposal</strong> is a visual, section-based document with images and an
              acceptance signature. Once an estimate is <strong>Accepted</strong>, use the green{" "}
              <em>Convert to Invoice</em> icon on the row.
            </HelpTip>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {docs.length} document{docs.length !== 1 ? "s" : ""}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="brand">
              <Plus className="mr-2 h-4 w-4" /> Create New
              <ChevronDown className="ml-2 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 bg-popover">
            <DropdownMenuItem onClick={onCreateNew}>
              <FileText className="mr-2 h-4 w-4" /> Estimate
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/admin/proposal-builder")}>
              <FileSignature className="mr-2 h-4 w-4" /> Proposal
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>


      <div className="space-y-5 p-4 sm:p-6">
        {/* Summary stat cards */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {statCards.map((s) => (
            <Card key={s.key} className="shadow-sm">
              <CardContent className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {s.label}
                </p>
                <p className="mt-1 text-2xl font-bold text-foreground">{s.count}</p>
                <p className="text-xs text-muted-foreground">{formatZAR(s.total)}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {selectedDrafts.length > 0 && (
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2">
            <p className="text-sm text-muted-foreground">
              {selectedDrafts.length} draft{selectedDrafts.length !== 1 ? "s" : ""} selected
            </p>
            <Button
              variant="destructive"
              size="sm"
              disabled={deleting}
              onClick={() => setPendingDelete(selectedDrafts)}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Delete drafts
            </Button>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search estimates and proposals..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {(["all", "estimate", "proposal"] as const).map((t) => (
              <Button
                key={t}
                variant={typeFilter === t ? "default" : "outline"}
                size="sm"
                onClick={() => setTypeFilter(t)}
                className="text-xs capitalize"
              >
                {t === "all" ? "All types" : `${t}s`}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {statuses.map((s) => (
              <Button
                key={s}
                variant={statusFilter === s ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter(s)}
                className="text-xs capitalize"
              >
                {s}
              </Button>
            ))}
          </div>
        </div>

        {/* Table */}
        {isLoading ? (
          <ListSkeleton rows={5} />
        ) : docs.length === 0 ? (
          <Card className="shadow-sm">
            <CardContent className="py-12 text-center text-muted-foreground">
              <FileText className="mx-auto mb-2 h-10 w-10 opacity-50" />
              <p>Nothing here yet. Create your first estimate or proposal!</p>
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={toggleAll}
                        aria-label="Select all documents"
                      />
                    </TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {docs.map((doc) => {
                    const quote = doc.raw;
                    return (
                      <TableRow key={`${doc.kind}-${doc.id}`} className="cursor-pointer" onClick={() => openDoc(doc)}>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selected.includes(doc.id)}
                            onCheckedChange={() => toggleOne(doc.id)}
                            aria-label={`Select ${doc.ref || ""}`}
                          />
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize text-muted-foreground">
                            {doc.kind === "proposal" ? (
                              <FileSignature className="h-3 w-3" />
                            ) : (
                              <FileText className="h-3 w-3" />
                            )}
                            {doc.kind}
                          </span>
                        </TableCell>
                        <TableCell
                          className={
                            doc.kind === "estimate"
                              ? "font-mono text-sm font-bold text-primary"
                              : "max-w-[220px] truncate text-sm font-semibold text-primary"
                          }
                        >
                          {doc.ref || <span className="text-xs text-warning">No number – draft</span>}
                        </TableCell>
                        <TableCell className="max-w-[220px]">
                          <p className="truncate text-sm text-foreground">
                            {doc.clientName || "No customer"}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {doc.clientPhone || ""}
                          </p>
                        </TableCell>
                        <TableCell>
                          <StatusPill status={doc.status} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {new Date(doc.created_at).toLocaleDateString("en-ZA")}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-bold text-foreground">
                          {formatZAR(doc.total)}
                        </TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-1">
                            {doc.kind === "estimate" && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => {
                                    onEditQuote(quote.id);
                                    toast({ title: "Open the quote to download PDF" });
                                  }}
                                  title="Download PDF"
                                >
                                  <Download className="h-3.5 w-3.5" />
                                </Button>
                                {quote.status === "accepted" && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 text-brand-green hover:text-brand-green"
                                    onClick={() => handleConvertToInvoice(quote.id)}
                                    disabled={converting === quote.id}
                                    title="Convert to Invoice"
                                  >
                                    {converting === quote.id ? (
                                      <Spinner size="xs" />
                                    ) : (
                                      <FileCheck2 className="h-3.5 w-3.5" />
                                    )}
                                  </Button>
                                )}
                              </>
                            )}
                            {quote.public_token && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  onClick={() => {
                                    navigator.clipboard.writeText(
                                      `${window.location.origin}/${doc.kind === "proposal" ? "proposal" : "quote"}/${quote.public_token}`,
                                    );
                                    toast({ title: "Link copied! 🔗" });
                                  }}
                                  title="Copy client link"
                                >
                                  <Link2 className="h-3.5 w-3.5" />
                                </Button>
                                <WhatsAppShareButton
                                  phone={doc.clientPhone}
                                  message={`Hi ${doc.clientName || "there"}, your ${doc.kind} ${doc.ref} for ${formatZAR(doc.total)} is ready. View it here: ${window.location.origin}/${doc.kind === "proposal" ? "proposal" : "quote"}/${quote.public_token}`}
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                />
                              </>
                            )}
                            {doc.status === "draft" && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() => setPendingDelete([doc])}
                                title="Delete draft"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>

              </Table>
            </div>
          </Card>
        )}
      </div>

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {pendingDelete?.length ?? 0} draft
              {(pendingDelete?.length ?? 0) !== 1 ? "s" : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the selected draft documents and their line items. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                if (pendingDelete) performDelete(pendingDelete as any);
              }}
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default QuotesList;
