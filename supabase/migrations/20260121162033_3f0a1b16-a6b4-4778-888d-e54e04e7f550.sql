-- Add priority and started_at fields to leads table
ALTER TABLE public.leads 
ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal',
ADD COLUMN IF NOT EXISTS started_at timestamp with time zone;

-- Create invoices table
CREATE TABLE public.invoices (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_number text NOT NULL UNIQUE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL,
  customer_name text NOT NULL,
  customer_phone text,
  customer_address text,
  line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal numeric(10,2) NOT NULL DEFAULT 0,
  tax_rate numeric(5,2) NOT NULL DEFAULT 0,
  tax_amount numeric(10,2) NOT NULL DEFAULT 0,
  grand_total numeric(10,2) NOT NULL DEFAULT 0,
  payment_method text,
  notes text,
  status text NOT NULL DEFAULT 'draft',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create invoice sequence for auto-numbering
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1;

-- Enable RLS on invoices
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

-- RLS policies for invoices
CREATE POLICY "Agents can view their own invoices"
ON public.invoices
FOR SELECT
USING (agent_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Agents can create their own invoices"
ON public.invoices
FOR INSERT
WITH CHECK (agent_id = auth.uid());

CREATE POLICY "Agents can update their own invoices"
ON public.invoices
FOR UPDATE
USING (agent_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete invoices"
ON public.invoices
FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));

-- Add realtime for invoices
ALTER PUBLICATION supabase_realtime ADD TABLE public.invoices;

-- Create function to generate invoice numbers
CREATE OR REPLACE FUNCTION public.generate_invoice_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_val integer;
BEGIN
  next_val := nextval('invoice_number_seq');
  RETURN 'INV-' || LPAD(next_val::text, 3, '0');
END;
$$;