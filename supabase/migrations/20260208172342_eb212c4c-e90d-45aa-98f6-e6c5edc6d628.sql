
-- 1. Add missing columns to customers
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS area TEXT;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS vat_number TEXT;

-- 2. Create invoice_items table
CREATE TABLE public.invoice_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  service_id UUID REFERENCES public.service_templates(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  amount NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agents can view their own invoice items"
ON public.invoice_items FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.invoices
    WHERE invoices.id = invoice_items.invoice_id
    AND (invoices.agent_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
  )
);

CREATE POLICY "Agents can insert items for their invoices"
ON public.invoice_items FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.invoices
    WHERE invoices.id = invoice_items.invoice_id
    AND (invoices.agent_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
  )
);

CREATE POLICY "Agents can update items for their invoices"
ON public.invoice_items FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.invoices
    WHERE invoices.id = invoice_items.invoice_id
    AND (invoices.agent_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
  )
);

CREATE POLICY "Agents can delete items for their invoices"
ON public.invoice_items FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.invoices
    WHERE invoices.id = invoice_items.invoice_id
    AND (invoices.agent_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
  )
);

-- 3. Add pdf_url to invoices
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS pdf_url TEXT;

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id ON public.invoice_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_items_service_id ON public.invoice_items(service_id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer_id ON public.invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON public.invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_agent_id ON public.invoices(agent_id);
CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON public.invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_customers_area ON public.customers(area);

-- 5. Realtime for invoice_items only (invoices already added)
ALTER PUBLICATION supabase_realtime ADD TABLE public.invoice_items;
