
-- =============================================
-- AUDIT LOG TABLE
-- =============================================
CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name text NOT NULL,
  record_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  old_data jsonb,
  new_data jsonb,
  user_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view audit log"
  ON public.audit_log FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "System can insert audit log"
  ON public.audit_log FOR INSERT
  WITH CHECK (true);

-- Index for fast lookups
CREATE INDEX idx_audit_log_table_record ON public.audit_log (table_name, record_id);
CREATE INDEX idx_audit_log_created_at ON public.audit_log (created_at DESC);

-- =============================================
-- GENERIC AUDIT TRIGGER FUNCTION
-- =============================================
CREATE OR REPLACE FUNCTION public.audit_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log (table_name, record_id, action, new_data, user_id)
    VALUES (TG_TABLE_NAME, NEW.id, 'insert', to_jsonb(NEW), auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, user_id)
    VALUES (TG_TABLE_NAME, NEW.id, 'update', to_jsonb(OLD), to_jsonb(NEW), auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_log (table_name, record_id, action, old_data, user_id)
    VALUES (TG_TABLE_NAME, OLD.id, 'delete', to_jsonb(OLD), auth.uid());
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

-- Attach audit triggers to key tables
CREATE TRIGGER audit_quotes AFTER INSERT OR UPDATE OR DELETE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

CREATE TRIGGER audit_invoices AFTER INSERT OR UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

CREATE TRIGGER audit_payments AFTER INSERT OR UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

CREATE TRIGGER audit_leads AFTER INSERT OR UPDATE OR DELETE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

CREATE TRIGGER audit_service_agreements AFTER INSERT OR UPDATE OR DELETE ON public.service_agreements
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger();

-- =============================================
-- DATA VALIDATION CONSTRAINTS
-- =============================================
-- Price/amount fields >= 0
ALTER TABLE public.quotes ADD CONSTRAINT quotes_subtotal_non_negative CHECK (subtotal >= 0);
ALTER TABLE public.quotes ADD CONSTRAINT quotes_total_non_negative CHECK (total >= 0);
ALTER TABLE public.quotes ADD CONSTRAINT quotes_vat_amount_non_negative CHECK (vat_amount >= 0);

ALTER TABLE public.invoices ADD CONSTRAINT invoices_subtotal_non_negative CHECK (subtotal >= 0);
ALTER TABLE public.invoices ADD CONSTRAINT invoices_grand_total_non_negative CHECK (grand_total >= 0);
ALTER TABLE public.invoices ADD CONSTRAINT invoices_tax_amount_non_negative CHECK (tax_amount >= 0);

ALTER TABLE public.payments ADD CONSTRAINT payments_amount_positive CHECK (amount > 0);

ALTER TABLE public.flat_rate_items ADD CONSTRAINT flat_rate_standard_price_non_negative CHECK (standard_price >= 0);

ALTER TABLE public.invoice_items ADD CONSTRAINT invoice_items_quantity_positive CHECK (quantity > 0);
ALTER TABLE public.invoice_items ADD CONSTRAINT invoice_items_unit_price_non_negative CHECK (unit_price >= 0);

ALTER TABLE public.quote_line_items ADD CONSTRAINT quote_line_items_quantity_positive CHECK (quantity > 0);
ALTER TABLE public.quote_line_items ADD CONSTRAINT quote_line_items_unit_price_non_negative CHECK (unit_price >= 0);

ALTER TABLE public.job_expenses ADD CONSTRAINT job_expenses_amount_positive CHECK (amount > 0);
