
-- 1. Add quote_id to existing invoices table and make lead_id nullable
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS quote_id uuid REFERENCES public.quotes(id),
  ALTER COLUMN lead_id DROP NOT NULL;

-- 2. Payments table
CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  method text NOT NULL CHECK (method IN ('cash', 'eft', 'card')),
  reference text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Job expenses table
CREATE TABLE public.job_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id),
  description text NOT NULL,
  amount numeric(10,2) NOT NULL,
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  receipt_path text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4. Proposal sections table
CREATE TABLE public.proposal_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  section_type text NOT NULL CHECK (section_type IN ('cover', 'summary', 'scope', 'assessment', 'solution', 'pricing', 'timeline', 'terms', 'warranty', 'about')),
  title text NOT NULL,
  content text,
  sort_order integer NOT NULL DEFAULT 0,
  photos jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 5. Proposal templates table
CREATE TABLE public.proposal_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  section_type text NOT NULL,
  default_title text NOT NULL,
  default_content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 6. Storage bucket for receipts
INSERT INTO storage.buckets (id, name, public) VALUES ('expense-receipts', 'expense-receipts', false);

-- 7. Enable RLS
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposal_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposal_templates ENABLE ROW LEVEL SECURITY;

-- Payments RLS
CREATE POLICY "Users can view payments for their invoices" ON public.payments
  FOR SELECT USING (EXISTS (SELECT 1 FROM invoices WHERE invoices.id = payments.invoice_id AND (invoices.agent_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))));
CREATE POLICY "Users can create payments" ON public.payments
  FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM invoices WHERE invoices.id = payments.invoice_id AND (invoices.agent_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))));
CREATE POLICY "Admins can delete payments" ON public.payments
  FOR DELETE USING (has_role(auth.uid(), 'admin'::app_role));

-- Job expenses RLS
CREATE POLICY "Users can view own expenses or admin" ON public.job_expenses
  FOR SELECT USING (created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Users can create expenses" ON public.job_expenses
  FOR INSERT WITH CHECK (created_by = auth.uid());
CREATE POLICY "Users can update own expenses" ON public.job_expenses
  FOR UPDATE USING (created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete expenses" ON public.job_expenses
  FOR DELETE USING (has_role(auth.uid(), 'admin'::app_role));

-- Proposal sections RLS
CREATE POLICY "Users can view proposal sections" ON public.proposal_sections
  FOR SELECT USING (EXISTS (SELECT 1 FROM quotes WHERE quotes.id = proposal_sections.quote_id AND (quotes.sales_engineer_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))));
CREATE POLICY "Users can insert proposal sections" ON public.proposal_sections
  FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM quotes WHERE quotes.id = proposal_sections.quote_id AND (quotes.sales_engineer_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))));
CREATE POLICY "Users can update proposal sections" ON public.proposal_sections
  FOR UPDATE USING (EXISTS (SELECT 1 FROM quotes WHERE quotes.id = proposal_sections.quote_id AND (quotes.sales_engineer_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))));
CREATE POLICY "Users can delete proposal sections" ON public.proposal_sections
  FOR DELETE USING (EXISTS (SELECT 1 FROM quotes WHERE quotes.id = proposal_sections.quote_id AND (quotes.sales_engineer_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))));

-- Proposal templates RLS
CREATE POLICY "Authenticated users can view proposal templates" ON public.proposal_templates
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Admins can manage proposal templates" ON public.proposal_templates
  FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update proposal templates" ON public.proposal_templates
  FOR UPDATE USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can delete proposal templates" ON public.proposal_templates
  FOR DELETE USING (has_role(auth.uid(), 'admin'::app_role));

-- Storage policies for receipts
CREATE POLICY "Auth users can upload receipts" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'expense-receipts' AND auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can view receipts" ON storage.objects
  FOR SELECT USING (bucket_id = 'expense-receipts' AND auth.uid() IS NOT NULL);
CREATE POLICY "Auth users can delete own receipts" ON storage.objects
  FOR DELETE USING (bucket_id = 'expense-receipts' AND auth.uid() IS NOT NULL);

-- 8. Trigger: auto-create invoice when quote accepted
CREATE OR REPLACE FUNCTION public.create_invoice_from_accepted_quote()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  new_invoice_id uuid;
  new_inv_number text;
  cust record;
BEGIN
  IF OLD.status IS DISTINCT FROM 'accepted' AND NEW.status = 'accepted' THEN
    IF EXISTS (SELECT 1 FROM invoices WHERE quote_id = NEW.id) THEN
      RETURN NEW;
    END IF;

    SELECT name, phone, email, address INTO cust FROM customers WHERE id = NEW.customer_id;
    new_inv_number := generate_invoice_number();

    INSERT INTO invoices (
      quote_id, lead_id, agent_id, customer_id, customer_name, customer_phone, customer_email, customer_address,
      invoice_number, subtotal, tax_rate, tax_amount, grand_total,
      due_date, status, line_items
    ) VALUES (
      NEW.id, NEW.lead_id, NEW.sales_engineer_id, NEW.customer_id,
      COALESCE(cust.name, ''), COALESCE(cust.phone, ''), cust.email, cust.address,
      new_inv_number, NEW.subtotal, NEW.vat_rate, NEW.vat_amount, NEW.total,
      CURRENT_DATE + 30, 'draft', '[]'::jsonb
    )
    RETURNING id INTO new_invoice_id;

    INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, amount)
    SELECT new_invoice_id, description, quantity, unit_price, quantity * unit_price
    FROM quote_line_items
    WHERE quote_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_quote_accepted
  AFTER UPDATE ON public.quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.create_invoice_from_accepted_quote();

-- 9. RPC: Invoice aging report
CREATE OR REPLACE FUNCTION public.get_invoice_aging_report()
RETURNS TABLE(bracket text, invoice_count bigint, total_outstanding numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    CASE
      WHEN CURRENT_DATE - i.due_date <= 30 THEN '0-30 days'
      WHEN CURRENT_DATE - i.due_date <= 60 THEN '31-60 days'
      WHEN CURRENT_DATE - i.due_date <= 90 THEN '61-90 days'
      ELSE '91+ days'
    END as bracket,
    COUNT(*)::bigint as invoice_count,
    SUM(i.grand_total - COALESCE(paid.total_paid, 0))::numeric as total_outstanding
  FROM invoices i
  LEFT JOIN (
    SELECT invoice_id, SUM(amount) as total_paid
    FROM payments
    GROUP BY invoice_id
  ) paid ON paid.invoice_id = i.id
  WHERE i.status NOT IN ('paid', 'cancelled')
    AND i.due_date IS NOT NULL
  GROUP BY
    CASE
      WHEN CURRENT_DATE - i.due_date <= 30 THEN '0-30 days'
      WHEN CURRENT_DATE - i.due_date <= 60 THEN '31-60 days'
      WHEN CURRENT_DATE - i.due_date <= 90 THEN '61-90 days'
      ELSE '91+ days'
    END
  ORDER BY MIN(CURRENT_DATE - i.due_date);
END;
$$;

-- 10. RPC: Job profit/loss
CREATE OR REPLACE FUNCTION public.job_profit_loss(p_lead_id uuid)
RETURNS TABLE(revenue numeric, expenses numeric, profit numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE((SELECT SUM(grand_total) FROM invoices WHERE lead_id = p_lead_id AND status = 'paid'), 0)::numeric as revenue,
    COALESCE((SELECT SUM(je.amount) FROM job_expenses je WHERE je.lead_id = p_lead_id), 0)::numeric as expenses,
    (COALESCE((SELECT SUM(grand_total) FROM invoices WHERE lead_id = p_lead_id AND status = 'paid'), 0) -
     COALESCE((SELECT SUM(je.amount) FROM job_expenses je WHERE je.lead_id = p_lead_id), 0))::numeric as profit;
END;
$$;

-- 11. Seed proposal templates
INSERT INTO public.proposal_templates (name, section_type, default_title, default_content) VALUES
('Cover Page', 'cover', 'Air Conditioning Proposal', '# AC Super Service\n## 0800-BE-COOL\n\nPrepared exclusively for your air conditioning requirements.\n\n*Professional HVAC Solutions*'),
('Executive Summary', 'summary', 'Executive Summary', 'Thank you for the opportunity to present our proposal for your air conditioning requirements. AC Super Service has been a trusted HVAC partner in South Africa, delivering professional installation, maintenance, and repair services.\n\nThis proposal outlines our recommended solution tailored to your specific needs, ensuring optimal comfort, energy efficiency, and long-term reliability.'),
('Site Assessment', 'assessment', 'Site Assessment', '## Site Inspection Findings\n\nOur qualified technician conducted a thorough assessment of your premises.\n\n### Key Observations:\n- Building size and layout assessed\n- Existing electrical infrastructure evaluated\n- Mounting positions identified\n- Drainage routes planned\n- Ambient conditions measured'),
('Scope of Work', 'scope', 'Scope of Work', '## What''s Included\n\n### Installation Works\n- Supply and installation of specified HVAC equipment\n- Copper piping and refrigerant charging\n- Condensate drainage installation\n- Electrical connections to existing DB board\n- System commissioning and performance testing\n- Handover and client training\n\n### Standards & Compliance\n- All work per SANS 10142-1 wiring regulations\n- Refrigerant handling per SANS 10147\n- Registered with the Department of Labour\n- COC provided where applicable'),
('Recommended Solution', 'solution', 'Recommended Solution', '## Our Recommendation\n\nBased on our site assessment, we recommend the following solution:\n\n### Equipment Specification\n- Brand and model as per quotation\n- Energy rating and capacity suited to your space\n- Inverter technology for energy efficiency\n- R410A environmentally-friendly refrigerant\n\n### Why This Solution?\n- Optimal cooling/heating capacity for your space\n- Energy-efficient operation reducing electricity costs\n- Quiet operation for comfort\n- Proven reliability and manufacturer support'),
('Terms & Conditions', 'terms', 'Terms & Conditions', '## Payment Terms\n- 50% deposit required upon acceptance\n- Balance due upon completion of installation\n- Payment via EFT, cash, or card\n- Prices include 15% VAT\n- Quote valid for 30 days\n\n## Important Notes\n- Electrical work: Separate COC may be required if DB board needs upgrading (quoted separately)\n- Building work: Brick-laying, plastering, ceiling repairs, or painting excluded unless quoted\n- Access: Client to ensure clear access to installation areas\n- Hours: Mon-Fri 08:00-17:00. Weekend/after-hours at additional cost\n- Load shedding: Timelines may be affected\n\n## Cancellation Policy\n- Before commencement: deposit refundable less 15% admin fee\n- After commencement: deposit non-refundable'),
('Warranty', 'warranty', 'Warranty Information', '## Manufacturer Warranty\n- **Compressor:** 5-year warranty\n- **Parts:** 2-year warranty\n- **PCB/Electronics:** 2-year warranty\n\n## Installation Warranty\n- **Workmanship:** 12-month warranty\n- **Piping & Connections:** 12-month warranty\n\n## Warranty Conditions\n- Void if serviced by non-authorised personnel\n- Annual maintenance required to maintain warranty\n- Does not cover power surge/lightning/load shedding damage\n- Claims must be reported within 7 days\n\n## Maintenance\n- Annual service recommended\n- Filter cleaning every 2-3 months\n- Maintenance contracts from R300/month per unit'),
('About Us', 'about', 'About AC Super Service', '## Who We Are\n\n**AC Super Service** is a leading HVAC solutions provider serving clients across South Africa.\n\n### Why Choose Us?\n- ✅ Qualified and experienced technicians\n- ✅ All major brands supplied and installed\n- ✅ 24/7 emergency breakdown service\n- ✅ Competitive pricing with no hidden costs\n- ✅ Fully insured and compliant\n\n### Contact\n📞 **0800-BE-COOL**\n📧 info@acsuperservice.co.za'),
('Project Timeline', 'timeline', 'Project Timeline', '## Estimated Timeline\n\n| Phase | Duration | Description |\n|-------|----------|-------------|\n| Deposit & Ordering | 1-3 days | Equipment ordered upon receipt of deposit |\n| Delivery | 3-7 days | Equipment delivery to site |\n| Installation | 1-2 days | On-site installation and piping |\n| Commissioning | Half day | System testing and handover |\n\n**Total: 5-12 working days from deposit**');
