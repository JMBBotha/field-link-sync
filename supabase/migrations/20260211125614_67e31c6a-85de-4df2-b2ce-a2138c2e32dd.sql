
-- Add stock_mode to inventory_stock
ALTER TABLE public.inventory_stock
ADD COLUMN stock_mode text NOT NULL DEFAULT 'order_as_needed'
CHECK (stock_mode IN ('order_as_needed', 'stock_sensitive'));

-- Update all existing rows
UPDATE public.inventory_stock SET stock_mode = 'order_as_needed';

-- Create stock_receipts table
CREATE TABLE public.stock_receipts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id),
  receipt_date timestamptz NOT NULL DEFAULT now(),
  items_received jsonb NOT NULL DEFAULT '[]',
  user_id uuid REFERENCES auth.users(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stock_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view receipts"
ON public.stock_receipts FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert receipts"
ON public.stock_receipts FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

-- Create stock_documents table
CREATE TABLE public.stock_documents (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  receipt_id uuid NOT NULL REFERENCES public.stock_receipts(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_type text NOT NULL DEFAULT 'pdf',
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.stock_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view stock documents"
ON public.stock_documents FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can insert stock documents"
ON public.stock_documents FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

-- Create storage bucket for stock documents
INSERT INTO storage.buckets (id, name, public) VALUES ('stock-documents', 'stock-documents', false);

CREATE POLICY "Authenticated users can upload stock documents"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'stock-documents' AND auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can view stock documents files"
ON storage.objects FOR SELECT
USING (bucket_id = 'stock-documents' AND auth.uid() IS NOT NULL);
