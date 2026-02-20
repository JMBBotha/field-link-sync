
-- Proposals table
CREATE TABLE public.proposals (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID REFERENCES public.customers(id),
  lead_id UUID REFERENCES public.leads(id),
  quote_id UUID REFERENCES public.quotes(id),
  proposal_number TEXT NOT NULL DEFAULT '',
  reference TEXT,
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  discount_type TEXT DEFAULT 'percent',
  discount_value NUMERIC NOT NULL DEFAULT 0,
  discount_amount NUMERIC NOT NULL DEFAULT 0,
  tax_rate NUMERIC NOT NULL DEFAULT 15,
  tax_amount NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  terms TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.proposals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view proposals" ON public.proposals FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can insert proposals" ON public.proposals FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update proposals" ON public.proposals FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can delete proposals" ON public.proposals FOR DELETE USING (auth.uid() IS NOT NULL);

CREATE TRIGGER update_proposals_updated_at BEFORE UPDATE ON public.proposals FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Proposal items table
CREATE TABLE public.proposal_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_id UUID NOT NULL REFERENCES public.proposals(id) ON DELETE CASCADE,
  service_id UUID REFERENCES public.service_templates(id),
  description TEXT NOT NULL DEFAULT '',
  quantity NUMERIC NOT NULL DEFAULT 1,
  rate NUMERIC NOT NULL DEFAULT 0,
  line_total NUMERIC NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.proposal_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view proposal_items" ON public.proposal_items FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can insert proposal_items" ON public.proposal_items FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can update proposal_items" ON public.proposal_items FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "Authenticated users can delete proposal_items" ON public.proposal_items FOR DELETE USING (auth.uid() IS NOT NULL);

-- Sequence + RPC for proposal numbers
CREATE SEQUENCE IF NOT EXISTS proposal_number_seq START WITH 1;

CREATE OR REPLACE FUNCTION public.generate_proposal_number()
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  next_val integer;
  current_year text;
BEGIN
  next_val := nextval('proposal_number_seq');
  current_year := to_char(now(), 'YYYY');
  RETURN 'PROP-' || current_year || '-' || LPAD(next_val::text, 4, '0');
END;
$$;

-- Storage bucket for proposal attachments
INSERT INTO storage.buckets (id, name, public) VALUES ('proposal-attachments', 'proposal-attachments', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Auth users upload proposal attachments" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'proposal-attachments' AND auth.uid() IS NOT NULL);
CREATE POLICY "Auth users view proposal attachments" ON storage.objects FOR SELECT USING (bucket_id = 'proposal-attachments' AND auth.uid() IS NOT NULL);
CREATE POLICY "Auth users delete proposal attachments" ON storage.objects FOR DELETE USING (bucket_id = 'proposal-attachments' AND auth.uid() IS NOT NULL);
