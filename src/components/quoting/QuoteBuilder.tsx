import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Plus, X, Loader2, Search, ChevronDown, ChevronUp, Paperclip, Upload, FileDown, Send, BookOpen, Check } from "lucide-react";
import { pdf } from "@react-pdf/renderer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useProductOptions, type ProductOption } from "@/hooks/useProductOptions";
import ProductSearchDropdown from "@/components/shared/ProductSearchDropdown";
import { useQuoteSessionStore } from "@/stores/quoteSessionStore";
import { useUnsavedQuoteGuard } from "@/hooks/useUnsavedQuoteGuard";
import UnsavedQuoteDialog from "@/components/shared/UnsavedQuoteDialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import BeCoolLogo from "@/components/shared/BeCoolLogo";
import DocumentHeader from "@/components/shared/DocumentHeader";
import QuotePDFDocument, { type QuotePDFData } from "@/components/QuotePDFDocument";
import { assembleQuoteWithBrochures } from "@/lib/pdfMerger";
import { DEFAULT_TERMS } from "@/lib/defaultTerms";
...
  const handleGeneratePdf = async () => {
    try {
      const finalQuoteNumber = quoteNumber || "QUOTE";

      const pdfData: QuotePDFData = {
        quoteNumber: finalQuoteNumber,
        date: issueDate,
        validUntil,
        clientName: customerName,
        clientEmail: customerEmail,
        items: lineItems
          .filter((item) => item.description.trim())
          .map((item) => ({
            areaName: item.description,
            unitName: "",
            btu: 0,
            quantity: item.quantity,
            unitPrice: item.rate,
            markupPercent: item.markup || 0,
            lineTotal: item.amount,
          })),
        subtotal: taxableAmount,
        vatRate: taxRate / 100,
        vatAmount: taxAmount,
        total,
        logoUrl,
      };

      const blob = await pdf(<QuotePDFDocument data={pdfData} />).toBlob();
      const pdfBytes = new Uint8Array(await blob.arrayBuffer());
      const fileName = `${finalQuoteNumber}.pdf`;

      if (selectedBrochures.length > 0) {
        const brochureAttachments = selectedBrochures.map((brochure) => {
          let url = brochure.file_url;
          if (!url.startsWith("http")) {
            const { data } = supabase.storage.from("product-brochures").getPublicUrl(url);
            url = data.publicUrl;
          }
          return { id: brochure.id, name: brochure.name, file_url: url };
        });

        const mergedPdfBytes = await assembleQuoteWithBrochures({
          mainQuotePdfBytes: pdfBytes,
          brochures: brochureAttachments,
          quoteNumber: finalQuoteNumber,
        });

        const mergedBlob = new Blob([new Uint8Array(mergedPdfBytes)], { type: "application/pdf" });
        const url = URL.createObjectURL(mergedBlob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } else {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      }

      toast({ title: "PDF Downloaded", description: `${fileName} with ${selectedBrochures.length} brochure(s) attached.` });
    } catch (err: any) {
      console.error("PDF generation error:", err);
      toast({ title: "PDF Error", description: err?.message || "PDF generation failed.", variant: "destructive" });
    }
  };

  /* ─── Render ─── */
  return (
    <div className="flex flex-col h-full bg-muted/40">
      {/* Exit guard modal */}
      <UnsavedQuoteDialog
        open={exitGuard.showModal}
        onContinue={exitGuard.confirmContinue}
        onSaveForLater={exitGuard.confirmSaveDraft}
        onDiscard={handleExit}
        onSendQuote={exitGuard.confirmSendQuote}
        onDeleteQuote={exitGuard.confirmDeleteQuote}
        canSave={canSave}
        canSend={canSave && lineItems.some(i => i.description && i.amount > 0)}
      />

      {/* ── Top bar ── */}
      <div data-pdf-hide className="sticky top-0 z-40 bg-background border-b px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-bold text-foreground">{quoteId ? "Edit Quote" : "New Quote"}</h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={exitGuard.requestExit}>
            Cancel
          </Button>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => saveQuote("draft")}
                    disabled={loading || !canSave}
                  >
                    Save Draft
                  </Button>
                </span>
              </TooltipTrigger>
              {!canSave && <TooltipContent>Assign a client to save this quote</TooltipContent>}
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    size="sm"
                    className="text-white"
                    style={{ backgroundColor: "#0077B6" }}
                    onClick={() => saveQuote("sent")}
                    disabled={loading || !canSave}
                  >
                    {loading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                    Send To…
                  </Button>
                </span>
              </TooltipTrigger>
              {!canSave && <TooltipContent>Assign a client to save this quote</TooltipContent>}
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {/* ── Scrollable content area ── */}
      <div className="flex-1 overflow-auto">
      {/* ── A4 Card ── */}
      <div data-pdf-capture-root="quote" className="max-w-3xl mx-auto my-8 bg-background shadow-lg rounded-lg border p-8 md:p-12 space-y-8">
        {/* ── HEADER ROW ── */}
        <DocumentHeader
          logoUrl={logoUrl}
          companyName={companySettings.company_name}
          physicalAddress={companySettings.physical_address}
          vatNumber={companySettings.vat_number}
        />

        {/* ── BILLED TO + DATES ROW ── */}
        <div className="space-y-1">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="col-span-1 space-y-1 relative">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Billed To</p>
              {customerName && !showCustomerPicker ? (
                <div>
                  <p className="text-sm font-semibold text-foreground">{customerName}</p>
                  {customerAddress && <p className="text-xs text-muted-foreground">{customerAddress}</p>}
                  {customerEmail && <p className="text-xs text-muted-foreground">{customerEmail}</p>}
                  <button data-pdf-hide onClick={() => setShowCustomerPicker(true)} className="text-[11px] text-primary hover:underline mt-1">Change</button>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      autoFocus
                      placeholder="Search clients…"
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                      className="w-full pl-7 pr-2 py-1.5 text-sm border rounded bg-background outline-none focus:ring-1 focus:ring-primary/30"
                    />
                  </div>
                  <div className="max-h-40 overflow-y-auto border rounded bg-popover shadow-md">
                    {filteredCustomers.slice(0, 8).map((c) => (
                      <button key={c.id} onClick={() => selectCustomer(c)} className="w-full text-left px-3 py-2 hover:bg-accent text-sm transition-colors">
                        <span className="font-medium">{c.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">{c.phone}</span>
                      </button>
                    ))}
                    {filteredCustomers.length === 0 && customerSearch && (
                      <p className="text-xs text-muted-foreground p-3">No clients found</p>
                    )}
                  </div>
                  <button
                    className="text-[11px] text-primary hover:underline flex items-center gap-1"
                    onClick={() => {
                      setCustomerName(customerSearch || "New Client");
                      setShowCustomerPicker(false);
                      setCustomerSearch("");
                    }}
                  >
                    <Plus className="h-3 w-3" /> Create a Client
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Date of Issue</p>
              <GhostInput type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </div>

            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Quote Number</p>
              <p className="text-sm font-medium text-foreground px-2 py-1.5">
                {!selectedCustomerId
                  ? <span className="text-amber-600 text-xs">Pending – assign a client</span>
                  : quoteNumber || "Generating…"}
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Quoted Amount (ZAR)</p>
              <p className="text-[28px] font-bold px-2 py-0.5" style={{ color: "#0077B6" }}>{formatCurrency(total)}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6" style={{ marginTop: "-12px" }}>
            <div />
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Valid Until</p>
              <GhostInput type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </div>
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Reference / PO#</p>
              <GhostInput placeholder="e.g. PO-1234" value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
            <div />
          </div>
        </div>

        <div className="h-[2px] w-full" style={{ backgroundColor: "#2c3e6b" }} />

        {/* ── LINE ITEMS TABLE ── */}
        <div>
          <div className="grid grid-cols-[1fr_80px_50px_60px_80px_30px] gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground border-b pb-2 mb-1">
            <div>Description</div>
            <div className="text-right">Cost</div>
            <div className="text-right">Qty</div>
            <div data-pdf-hide-markup className="text-right">Markup%</div>
            <div className="text-right">Total</div>
            <div />
          </div>

          {lineItems.map((item, idx) => (
            <div key={idx} className="grid grid-cols-[1fr_80px_50px_60px_80px_30px] gap-2 items-center py-1 group relative">
              <div className="relative">
                <ProductSearchDropdown value={item.description} allOptions={allOptions} onChange={(val) => updateLineItem(idx, "description", val)} onSelect={(opt) => pickOption(opt, idx)} />
                <span data-pdf-static className="hidden px-2 py-1.5 text-sm">{item.description || ""}</span>
              </div>
              <div><GhostInput type="number" min="0" step="0.01" className="text-right" value={item.rate || ""} onChange={(e) => updateLineItem(idx, "rate", e.target.value)} placeholder="0.00" /></div>
              <div><GhostInput type="number" min="0" step="1" className="text-right" value={item.quantity || ""} onChange={(e) => updateLineItem(idx, "quantity", e.target.value)} placeholder="1" /></div>
              <div data-pdf-hide-markup><GhostInput type="number" min="0" step="1" className="text-right" value={item.markup || ""} onChange={(e) => updateLineItem(idx, "markup", e.target.value)} placeholder="0" /></div>
              <div className="text-right text-sm font-medium py-1.5 px-2">{formatCurrency(item.amount)}</div>
              <div className="flex justify-center">
                <button onClick={() => removeLineItem(idx)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"><X className="h-4 w-4" /></button>
              </div>
            </div>
          ))}

          <button data-pdf-hide onClick={addLineItem} className="w-full text-left px-2 py-2.5 text-sm text-primary hover:bg-primary/5 rounded mt-1 flex items-center gap-1.5 transition-colors">
            <Plus className="h-4 w-4" /> Add a Line
          </button>
        </div>

        <div className="h-px bg-border" />

        {/* ── TOTALS ── */}
        <div className="flex justify-end">
          <div className="w-72 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>
            {!showDiscount ? (
              <button data-pdf-hide onClick={() => setShowDiscount(true)} className="text-sm text-primary hover:underline">+ Add a Discount</button>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Discount</span>
                <select value={discountType} onChange={(e) => setDiscountType(e.target.value as "percent" | "fixed")} className="text-xs border rounded px-1.5 py-1 bg-background">
                  <option value="percent">%</option>
                  <option value="fixed">ZAR</option>
                </select>
                <GhostInput type="number" min="0" className="w-20 text-right" value={discountValue || ""} onChange={(e) => setDiscountValue(Number(e.target.value) || 0)} />
                <span className="text-sm ml-auto">-{formatCurrency(discountAmount)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Tax ({taxRate}% VAT)</span>
              <span>{formatCurrency(taxAmount)}</span>
            </div>
            <div className="h-px bg-border" />
            <div className="flex justify-between text-base font-bold p-2 rounded" style={{ backgroundColor: "#0077B610", color: "#0077B6" }}>
              <span>Total (ZAR)</span>
              <span>{formatCurrency(total)}</span>
            </div>
          </div>
        </div>

        <div className="h-px bg-border" />

        {/* ── LINK TO JOB ── */}
        <div>
          <button data-pdf-hide className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors" onClick={() => setShowLinks(!showLinks)}>
            {showLinks ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            Link to Job
          </button>
          {showLinks && (
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Lead / Job</p>
                <select value={selectedLeadId} onChange={(e) => setSelectedLeadId(e.target.value)} className="w-full border rounded px-2 py-1.5 text-sm bg-background">
                  <option value="">— None —</option>
                  {leads.map((l) => (
                    <option key={l.id} value={l.id}>{l.customer_name} – {l.service_type}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>

        <div className="h-px bg-border" />

        {/* ── NOTES ── */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Notes</p>
          <Textarea placeholder="Notes — any relevant information not already covered" value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[60px] text-sm border-transparent hover:border-border focus:border-primary" />
        </div>

        {/* ── TERMS ── */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Terms</p>
          <Textarea value={terms} onChange={(e) => setTerms(e.target.value)} className="min-h-[80px] text-sm border-transparent hover:border-border focus:border-primary" />
        </div>

        

        <div className="h-px bg-border" />

        {/* ── BROCHURES (PDF attachments) ── */}
        <div data-pdf-hide className="space-y-3 rounded-lg border border-dashed border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground flex items-center gap-1.5">
              <BookOpen className="h-3.5 w-3.5 text-primary" /> Product Brochures
            </p>
            <span className="text-[10px] text-muted-foreground">
              {selectedBrochures.length} selected — will be appended to PDF
            </span>
          </div>

          {/* Selected brochures */}
          {selectedBrochures.length > 0 && (
            <div className="space-y-1">
              {selectedBrochures.map((b) => (
                <div key={b.id} className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-1.5 text-sm">
                  <span className="flex items-center gap-1.5">
                    <Check className="h-3.5 w-3.5 text-primary" />
                    {b.name}
                  </span>
                  <button
                    onClick={() => setSelectedBrochures((prev) => prev.filter((x) => x.id !== b.id))}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add brochure picker */}
          {!showBrochurePicker ? (
            <button
              onClick={() => setShowBrochurePicker(true)}
              className="text-sm text-primary hover:underline flex items-center gap-1.5"
            >
              <Plus className="h-4 w-4" /> Add Brochure
            </button>
          ) : (
            <div className="space-y-2 border rounded-md p-3 bg-muted/20">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  autoFocus
                  placeholder="Search brochures…"
                  value={brochureSearch}
                  onChange={(e) => setBrochureSearch(e.target.value)}
                  className="w-full pl-7 pr-2 py-1.5 text-sm border rounded bg-background outline-none focus:ring-1 focus:ring-primary/30"
                />
              </div>
              <div className="max-h-48 overflow-y-auto space-y-0.5">
                {availableBrochures
                  .filter((b) => {
                    const q = brochureSearch.toLowerCase();
                    return !selectedBrochures.some((s) => s.id === b.id) &&
                      (!q || b.name.toLowerCase().includes(q) || (b.brand || "").toLowerCase().includes(q));
                  })
                  .map((b) => (
                    <button
                      key={b.id}
                      onClick={() => {
                        setSelectedBrochures((prev) => [...prev, { id: b.id, name: b.name, file_url: b.file_url }]);
                      }}
                      className="w-full text-left px-3 py-1.5 hover:bg-accent text-sm transition-colors rounded flex items-center justify-between"
                    >
                      <span>{b.name}</span>
                      {b.brand && <span className="text-[10px] text-muted-foreground">{b.brand}</span>}
                    </button>
                  ))}
              </div>
              <button
                onClick={() => { setShowBrochurePicker(false); setBrochureSearch(""); }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Done
              </button>
            </div>
          )}
        </div>

        {/* ── ATTACHMENTS ── */}
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Attachments</p>
          <div className="flex flex-wrap gap-2">
            {attachments.map((a, idx) => (
              <a key={idx} href={a.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 border rounded-md px-3 py-1.5 text-sm hover:bg-muted transition-colors">
                <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                {a.name}
              </a>
            ))}
          </div>
          <label className="inline-flex items-center gap-1.5 text-sm text-primary cursor-pointer hover:underline">
            <Upload className="h-4 w-4" />
            {uploading ? "Uploading…" : "Upload Files"}
            <input ref={fileRef} type="file" multiple className="hidden" onChange={handleFileUpload} disabled={uploading} />
          </label>
        </div>
      </div>
      </div>{/* end scrollable content area */}

      {/* ── Bottom action bar — outside scroll container ── */}
      <div data-pdf-hide className="shrink-0 z-40 bg-background border-t px-4 py-3 flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" type="button" onClick={handleGeneratePdf}>
          <FileDown className="h-4 w-4 mr-1" />PDF
        </Button>
        <Button variant="outline" size="sm" onClick={() => toast({ title: "Email placeholder", description: "Email sending will be connected soon." })} disabled={!canSave}>
          <Send className="h-4 w-4 mr-1" />Send
        </Button>
        <Button variant="outline" size="sm" onClick={() => saveQuote("accepted")} disabled={loading || !canSave}>
          Mark Approved
        </Button>
        <Button variant="outline" size="sm" onClick={() => saveQuote("draft")} disabled={loading || !canSave}>
          Save Draft
        </Button>
        <Button size="sm" className="text-white" style={{ backgroundColor: "#0077B6" }} onClick={() => saveQuote("sent")} disabled={loading || !canSave}>
          {loading && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
          Send Quote
        </Button>
      </div>
    </div>
  );
};

export default QuoteBuilder;
