
-- Create company_invoices table (new separate table, does NOT replace fb_invoices or invoices)
CREATE TABLE public.company_invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  customer_id     uuid REFERENCES public.customers(id),
  quote_id        uuid REFERENCES public.quotes(id),
  quote_number    text,
  status          text NOT NULL DEFAULT 'Draft'
                  CHECK (status IN ('Draft','Sent','Viewed','Partial','Paid','Overdue','Archived')),
  invoice_number  text NOT NULL,
  due_date        date,
  subtotal        numeric NOT NULL DEFAULT 0,
  vat_amount      numeric NOT NULL DEFAULT 0,
  total_amount    numeric NOT NULL DEFAULT 0,
  amount_paid     numeric NOT NULL DEFAULT 0,
  recurrence      jsonb,
  notes           text,
  contact_id      uuid REFERENCES public.fb_contacts(id),
  items           jsonb DEFAULT '[]'::jsonb,
  tax             numeric NOT NULL DEFAULT 0,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX idx_company_invoices_company_status ON public.company_invoices(company_id, status);
CREATE INDEX idx_company_invoices_company_due_date ON public.company_invoices(company_id, due_date);
CREATE INDEX idx_company_invoices_company_customer ON public.company_invoices(company_id, customer_id);
CREATE INDEX idx_company_invoices_created_at ON public.company_invoices(created_at);
CREATE INDEX idx_company_invoices_contact ON public.company_invoices(company_id, contact_id);

-- Updated_at trigger
CREATE TRIGGER update_company_invoices_updated_at
  BEFORE UPDATE ON public.company_invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE public.company_invoices ENABLE ROW LEVEL SECURITY;

-- Select: company members can view
CREATE POLICY "Company members can view invoices"
  ON public.company_invoices FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.company_members
      WHERE company_members.company_id = company_invoices.company_id
        AND company_members.user_id = auth.uid()
    )
  );

-- Insert: company members can create
CREATE POLICY "Company members can create invoices"
  ON public.company_invoices FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.company_members
      WHERE company_members.company_id = company_invoices.company_id
        AND company_members.user_id = auth.uid()
    )
  );

-- Update: company members can update
CREATE POLICY "Company members can update invoices"
  ON public.company_invoices FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.company_members
      WHERE company_members.company_id = company_invoices.company_id
        AND company_members.user_id = auth.uid()
    )
  );

-- Delete: company members can delete
CREATE POLICY "Company members can delete invoices"
  ON public.company_invoices FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.company_members
      WHERE company_members.company_id = company_invoices.company_id
        AND company_members.user_id = auth.uid()
    )
  );

-- Also add anon policies matching fb_invoices pattern (RLS disabled on fb_* tables, 
-- but company_invoices needs public access for client portal/demo)
CREATE POLICY "Public read company invoices"
  ON public.company_invoices FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Public insert company invoices"
  ON public.company_invoices FOR INSERT
  TO anon
  WITH CHECK (true);

CREATE POLICY "Public update company invoices"
  ON public.company_invoices FOR UPDATE
  TO anon
  USING (true);

CREATE POLICY "Public delete company invoices"
  ON public.company_invoices FOR DELETE
  TO anon
  USING (true);

-- Update fb_payments foreign key to also allow linking to company_invoices
-- Add a company_invoice_id column to fb_payments for the transition
ALTER TABLE public.fb_payments ADD COLUMN IF NOT EXISTS company_invoice_id uuid REFERENCES public.company_invoices(id);
