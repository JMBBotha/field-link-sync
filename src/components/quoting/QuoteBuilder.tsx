import { useState, useEffect, useMemo } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import CustomerSearchDropdown from "@/components/CustomerSearchDropdown";
import ClientInfoPopover from "@/components/ClientInfoPopover";
import type { UnifiedClient } from "@/hooks/useUnifiedClients";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useCompanySettings } from "@/hooks/useCompanySettings";
import {
  Plus,
  Trash2,
  Save,
  Send,
  Eye,
  ArrowLeft,
  Loader2,
  Printer,
  BookmarkPlus,
} from "lucide-react";
import WhatsAppShareButton from "@/components/WhatsAppShareButton";
import TemplateSelector from "./TemplateSelector";
import PhotoUploader from "./PhotoUploader";
import BrandedQuotePreview from "./BrandedQuotePreview";
import QuoteAIAssistant from "./QuoteAIAssistant";
import FlatRatePickerDrawer from "@/components/flatrate/FlatRatePickerDrawer";
import CatalogPickerDrawer from "@/components/catalog/CatalogPickerDrawer";
import VisualSectionEditor, { type VisualSection } from "./VisualSectionEditor";
import TemplateSaveDialog from "./TemplateSaveDialog";

const formatZAR = (n: number) =>
  new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(n);

interface LineItemForm {
  service_id?: string;
  description: string;
  quantity: number;
  unit_price: number;
}

interface QuoteForm {
  customer_id: string;
  notes: string;
  valid_until: string;
  reference_text: string;
  terms_text: string;
  discount_type: string;
  discount_value: number;
  line_items: LineItemForm[];
}

interface Attachment {
  id?: string;
  storage_path: string;
  filename: string;
  caption: string;
  url: string;
}

interface QuoteBuilderProps {
  quoteId?: string | null;
  leadId?: string | null;
  onBack: () => void;
}

const DEFAULT_TERMS = `1. This quotation is valid for 30 days from the date of issue.
2. A 50% deposit is required upon acceptance to commence work.
3. Balance due upon completion of work.
4. All prices include 15% VAT as per South African law.
5. Warranty: 12 months on parts, 90 days on labour.
6. Payment terms: EFT, cash, or card on site.`;

const QuoteBuilder = ({ quoteId, leadId, onBack }: QuoteBuilderProps) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { settings } = useCompanySettings();
  const [savedQuoteId, setSavedQuoteId] = useState<string | null>(quoteId || null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [flatRateOpen, setFlatRateOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [visualSections, setVisualSections] = useState<VisualSection[]>([]);
  const [templateSaveOpen, setTemplateSaveOpen] = useState(false);

  const defaultValid = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];

  const { register, control, handleSubmit, watch, reset, setValue } = useForm<QuoteForm>({
    defaultValues: {
      customer_id: "",
      notes: "",
      valid_until: defaultValid,
      reference_text: "",
      terms_text: DEFAULT_TERMS,
      discount_type: "none",
      discount_value: 0,
      line_items: [{ description: "", quantity: 1, unit_price: 0 }],
    },
  });

  const { fields, append, remove, replace } = useFieldArray({ control, name: "line_items" });
  const watchedItems = watch("line_items");
  const watchedCustomerId = watch("customer_id");
  const watchedDiscountType = watch("discount_type");
  const watchedDiscountValue = watch("discount_value");

  // Fetch customers (still needed for selectedCustomer reference)
  const { data: customers = [] } = useQuery({
    queryKey: ["customers-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("id, name, phone, email, address").order("name");
      if (error) throw error;
      return data;
    },
  });

  // Pre-populate from lead
  useEffect(() => {
    if (!leadId || quoteId) return;
    const loadLead = async () => {
      const { data: lead } = await supabase.from("leads").select("*").eq("id", leadId).single();
      if (!lead) return;
      // If lead has a customer_id, set it
      if (lead.customer_id) {
        setValue("customer_id", lead.customer_id);
      }
    };
    loadLead();
  }, [leadId, quoteId]);

  // Fetch HVAC services
  const { data: services = [] } = useQuery({
    queryKey: ["hvac-services"],
    queryFn: async () => {
      const { data, error } = await supabase.from("hvac_services").select("*").eq("is_active", true).order("category, name");
      if (error) throw error;
      return data;
    },
  });

  // Load existing quote
  useEffect(() => {
    if (!quoteId) return;
    const load = async () => {
      const { data: quote } = await supabase.from("quotes").select("*").eq("id", quoteId).single();
      if (!quote) return;
      const { data: items } = await supabase.from("quote_line_items").select("*").eq("quote_id", quoteId);
      const { data: atts } = await supabase.from("quote_attachments").select("*").eq("quote_id", quoteId);

      reset({
        customer_id: quote.customer_id || "",
        notes: quote.notes || "",
        valid_until: quote.valid_until || defaultValid,
        reference_text: (quote as any).reference_text || "",
        terms_text: (quote as any).terms_text || DEFAULT_TERMS,
        discount_type: (quote as any).discount_type || "none",
        discount_value: Number((quote as any).discount_value) || 0,
        line_items: items?.length
          ? items.map((it: any) => ({ service_id: it.service_id, description: it.description, quantity: it.quantity, unit_price: Number(it.unit_price) }))
          : [{ description: "", quantity: 1, unit_price: 0 }],
      });

      // Load visual sections
      const sections = (quote as any).visual_sections;
      if (Array.isArray(sections) && sections.length > 0) {
        setVisualSections(sections);
      }

      if (atts?.length) {
        setAttachments(
          atts.map((a: any) => ({
            id: a.id,
            storage_path: a.storage_path,
            filename: a.filename || "",
            caption: a.caption || "",
            url: supabase.storage.from("quote-photos").getPublicUrl(a.storage_path).data.publicUrl,
          }))
        );
      }
    };
    load();
  }, [quoteId]);

  // Calculations
  const subtotal = useMemo(
    () => watchedItems.reduce((sum, item) => sum + (item.quantity || 0) * (item.unit_price || 0), 0),
    [watchedItems]
  );

  const discountAmount = useMemo(() => {
    if (watchedDiscountType === "percentage") return subtotal * ((watchedDiscountValue || 0) / 100);
    if (watchedDiscountType === "fixed") return watchedDiscountValue || 0;
    return 0;
  }, [subtotal, watchedDiscountType, watchedDiscountValue]);

  const afterDiscount = subtotal - discountAmount;
  const vatRate = 0.15;
  const vatAmount = afterDiscount * vatRate;
  const total = afterDiscount + vatAmount;

  const selectedCustomer = customers.find((c: any) => c.id === watchedCustomerId);

  const addService = (serviceId: string) => {
    const svc = services.find((s: any) => s.id === serviceId);
    if (svc) {
      append({ service_id: svc.id, description: svc.name, quantity: 1, unit_price: Number(svc.default_price) });
    }
  };

  const handleTemplateSelect = (items: LineItemForm[], sections?: VisualSection[], termsText?: string) => {
    replace(items);
    if (sections?.length) setVisualSections(sections);
    if (termsText) setValue("terms_text", termsText);
  };

  // Save
  const saveQuote = async (formData: QuoteForm, sendAfterSave = false) => {
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const quotePayload: any = {
        customer_id: formData.customer_id || null,
        sales_engineer_id: session.user.id,
        subtotal,
        vat_rate: vatRate,
        vat_amount: vatAmount,
        total,
        notes: formData.notes || null,
        valid_until: formData.valid_until || null,
        visual_sections: visualSections,
        terms_text: formData.terms_text || null,
        discount_type: formData.discount_type || "none",
        discount_value: formData.discount_value || 0,
        reference_text: formData.reference_text || null,
        ...(sendAfterSave ? { status: "sent", sent_at: new Date().toISOString() } : {}),
      };

      let qId = savedQuoteId;

      if (qId) {
        const { error } = await supabase.from("quotes").update(quotePayload).eq("id", qId);
        if (error) throw error;
        await supabase.from("quote_line_items").delete().eq("quote_id", qId);
      } else {
        const { data, error } = await supabase.from("quotes").insert(quotePayload).select("id").single();
        if (error) throw error;
        qId = data.id;
        setSavedQuoteId(qId);
      }

      const lineItems = formData.line_items
        .filter((item) => item.description.trim())
        .map((item) => ({
          quote_id: qId!,
          service_id: item.service_id || null,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
        }));

      if (lineItems.length) {
        const { error } = await supabase.from("quote_line_items").insert(lineItems);
        if (error) throw error;
      }

      queryClient.invalidateQueries({ queryKey: ["quotes"] });
      toast({ title: sendAfterSave ? "Quote sent!" : "Quote saved!" });
      if (sendAfterSave) onBack();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const previewData = {
    quote_number: savedQuoteId ? "Loading..." : "New Quote",
    status: "draft",
    customer_name: selectedCustomer?.name,
    customer_address: selectedCustomer?.address,
    customer_phone: selectedCustomer?.phone,
    customer_email: selectedCustomer?.email,
    valid_until: watch("valid_until"),
    notes: watch("notes"),
    reference_text: watch("reference_text"),
    discount_type: watchedDiscountType,
    discount_value: watchedDiscountValue,
    subtotal,
    vat_rate: vatRate,
    vat_amount: vatAmount,
    total,
    line_items: watchedItems,
    visual_sections: visualSections,
    terms_text: watch("terms_text"),
  };

  const logoUrl = settings.logo_storage_path
    ? supabase.storage.from("company-logos").getPublicUrl(settings.logo_storage_path).data.publicUrl
    : null;

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-xl font-bold">{quoteId ? "Edit Quote" : "New Quote"}</h2>
      </div>

      {/* Company Header Preview Bar */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="py-3 px-4">
          <div className="flex items-center gap-3">
            {logoUrl ? (
              <img src={logoUrl} alt="Logo" className="h-10 object-contain" />
            ) : (
              <div className="text-sm font-bold text-primary">{settings.company_name || "Your Company"}</div>
            )}
            <div className="text-xs text-muted-foreground">
              {settings.vat_number && <span>VAT: {settings.vat_number} • </span>}
              <span>0800-BE-COOL</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <form onSubmit={handleSubmit((data) => saveQuote(data))} className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Left: Main Content */}
        <div className="lg:col-span-2 space-y-4">
          {/* Customer, Template & Metadata */}
          <Card>
            <CardContent className="pt-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Customer</Label>
                  <ClientInfoPopover customerId={watchedCustomerId || null}>
                    <div>
                      <CustomerSearchDropdown
                        value={watchedCustomerId}
                        onSelect={(client: UnifiedClient) => setValue("customer_id", client.customer_id || client.id)}
                        placeholder="Search customers..."
                      />
                    </div>
                  </ClientInfoPopover>
                </div>
                <div>
                  <Label>Template</Label>
                  <TemplateSelector onSelect={handleTemplateSelect} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Valid Until</Label>
                  <Input type="date" {...register("valid_until")} />
                </div>
                <div>
                  <Label>Reference</Label>
                  <Input placeholder="Optional reference..." {...register("reference_text")} />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Line Items */}
          <Card>
            <CardHeader className="py-3 px-4">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Line Items</CardTitle>
                <Select onValueChange={addService}>
                  <SelectTrigger className="w-48 h-8 text-xs">
                    <SelectValue placeholder="Quick add service..." />
                  </SelectTrigger>
                  <SelectContent>
                    {services.map((s: any) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name} — {formatZAR(Number(s.default_price))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <div className="space-y-2">
                <div className="hidden sm:grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-1">
                  <div className="col-span-5">Description</div>
                  <div className="col-span-2 text-center">Qty</div>
                  <div className="col-span-2 text-right">Rate (ZAR)</div>
                  <div className="col-span-2 text-right">Total</div>
                  <div className="col-span-1" />
                </div>

                {fields.map((field, index) => {
                  const qty = watchedItems[index]?.quantity || 0;
                  const price = watchedItems[index]?.unit_price || 0;
                  return (
                    <div key={field.id} className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-12 sm:col-span-5">
                        <Input placeholder="Description" {...register(`line_items.${index}.description`)} className="h-8 text-sm" />
                      </div>
                      <div className="col-span-4 sm:col-span-2">
                        <Input type="number" min={1} {...register(`line_items.${index}.quantity`, { valueAsNumber: true })} className="h-8 text-sm text-center" />
                      </div>
                      <div className="col-span-4 sm:col-span-2">
                        <Input type="number" step="0.01" min={0} {...register(`line_items.${index}.unit_price`, { valueAsNumber: true })} className="h-8 text-sm text-right" />
                      </div>
                      <div className="col-span-3 sm:col-span-2 text-right text-sm font-medium pr-1">
                        {formatZAR(qty * price)}
                      </div>
                      <div className="col-span-1">
                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => fields.length > 1 && remove(index)} disabled={fields.length <= 1}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  );
                })}

                <div className="flex items-center gap-2 mt-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => append({ description: "", quantity: 1, unit_price: 0 })}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Line
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setFlatRateOpen(true)}>
                    📖 Flat Rate Book
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setCatalogOpen(true)}>
                    📦 Product Catalog
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Discount */}
          <Card>
            <CardContent className="pt-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
                <div>
                  <Label>Discount</Label>
                  <Select value={watchedDiscountType} onValueChange={(v) => setValue("discount_type", v)}>
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No Discount</SelectItem>
                      <SelectItem value="percentage">Percentage (%)</SelectItem>
                      <SelectItem value="fixed">Fixed Amount (R)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {watchedDiscountType !== "none" && (
                  <div>
                    <Label>{watchedDiscountType === "percentage" ? "Discount %" : "Amount (R)"}</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      {...register("discount_value", { valueAsNumber: true })}
                      className="h-8 text-sm"
                    />
                  </div>
                )}
                {discountAmount > 0 && (
                  <p className="text-sm text-success font-medium">
                    Saving: {formatZAR(discountAmount)}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* AI Assistant */}
          <QuoteAIAssistant onAddItem={(item) => append({ ...item, service_id: undefined })} />

          {/* Visual Content Sections */}
          <VisualSectionEditor
            sections={visualSections}
            onChange={setVisualSections}
            quoteId={savedQuoteId}
          />

          {/* Notes */}
          <Card>
            <CardContent className="pt-4">
              <Label>Notes</Label>
              <Textarea placeholder="Additional notes for the client..." {...register("notes")} rows={3} />
            </CardContent>
          </Card>

          {/* Terms & Conditions */}
          <Card>
            <CardContent className="pt-4">
              <Label>Terms & Conditions</Label>
              <Textarea
                {...register("terms_text")}
                rows={6}
                className="text-xs font-mono"
              />
            </CardContent>
          </Card>
        </div>

        {/* Right: Photos + Summary + Actions */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm">Photos</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <PhotoUploader quoteId={savedQuoteId} attachments={attachments} onAttachmentsChange={setAttachments} />
            </CardContent>
          </Card>

          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="py-3 px-4">
              <CardTitle className="text-sm">VAT Summary (ZAR)</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Subtotal</span>
                <span>{formatZAR(subtotal)}</span>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-sm text-success">
                  <span>Discount</span>
                  <span>-{formatZAR(discountAmount)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">VAT (15%)</span>
                <span>{formatZAR(vatAmount)}</span>
              </div>
              <Separator />
              <div className="flex justify-between font-bold">
                <span>Total</span>
                <span>{formatZAR(total)}</span>
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex flex-col gap-2">
            <Button type="button" variant="outline" onClick={() => setPreviewOpen(true)}>
              <Eye className="h-4 w-4 mr-2" /> Preview
            </Button>
            <Button type="button" variant="outline" onClick={() => window.print()}>
              <Printer className="h-4 w-4 mr-2" /> Print
            </Button>
            <Button type="button" variant="outline" onClick={() => setTemplateSaveOpen(true)}>
              <BookmarkPlus className="h-4 w-4 mr-2" /> Save as Template
            </Button>
            {savedQuoteId && selectedCustomer && (
              <WhatsAppShareButton
                phone={selectedCustomer.phone}
                message={`Hi ${selectedCustomer.name}, your quote for ${formatZAR(total)} is ready.`}
                variant="outline"
              >
                Send via WhatsApp
              </WhatsAppShareButton>
            )}
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save Draft
            </Button>
            <Button
              type="button"
              disabled={saving}
              className="bg-success hover:bg-success/90 text-primary-foreground"
              onClick={handleSubmit((data) => saveQuote(data, true))}
            >
              <Send className="h-4 w-4 mr-2" /> Save & Send
            </Button>
          </div>
        </div>
      </form>

      <BrandedQuotePreview open={previewOpen} onOpenChange={setPreviewOpen} quote={previewData} />
      <FlatRatePickerDrawer open={flatRateOpen} onOpenChange={setFlatRateOpen} onAddToQuote={(item) => append({ ...item, service_id: undefined })} />
      <CatalogPickerDrawer open={catalogOpen} onOpenChange={setCatalogOpen} onAddToQuote={(item) => append({ ...item, service_id: undefined })} />
      <TemplateSaveDialog
        open={templateSaveOpen}
        onOpenChange={setTemplateSaveOpen}
        lineItems={watchedItems}
        sections={visualSections}
        termsText={watch("terms_text")}
      />
    </div>
  );
};

export default QuoteBuilder;
