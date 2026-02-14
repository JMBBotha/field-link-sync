
-- Create storage bucket for supplier PDF page images
INSERT INTO storage.buckets (id, name, public) VALUES ('supplier-pdf-pages', 'supplier-pdf-pages', true)
ON CONFLICT (id) DO NOTHING;

-- Create storage bucket for product images
INSERT INTO storage.buckets (id, name, public) VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for supplier-pdf-pages
CREATE POLICY "Anyone can view pdf pages" ON storage.objects FOR SELECT USING (bucket_id = 'supplier-pdf-pages');
CREATE POLICY "Authenticated users can upload pdf pages" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'supplier-pdf-pages' AND auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can delete pdf pages" ON storage.objects FOR DELETE USING (bucket_id = 'supplier-pdf-pages' AND auth.role() = 'authenticated');

-- Storage policies for product-images
CREATE POLICY "Anyone can view product images" ON storage.objects FOR SELECT USING (bucket_id = 'product-images');
CREATE POLICY "Authenticated users can upload product images" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'product-images' AND auth.role() = 'authenticated');
CREATE POLICY "Authenticated users can delete product images" ON storage.objects FOR DELETE USING (bucket_id = 'product-images' AND auth.role() = 'authenticated');

-- Create supplier_pdf_pages table
CREATE TABLE public.supplier_pdf_pages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  supplier_id TEXT NOT NULL,
  pdf_filename TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  page_image_url TEXT NOT NULL,
  uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.supplier_pdf_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view pdf pages" ON public.supplier_pdf_pages FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert pdf pages" ON public.supplier_pdf_pages FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can delete pdf pages" ON public.supplier_pdf_pages FOR DELETE TO authenticated USING (true);

-- Create pdf_product_regions table
CREATE TABLE public.pdf_product_regions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pdf_page_id UUID NOT NULL REFERENCES public.supplier_pdf_pages(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.supplier_products(id) ON DELETE SET NULL,
  product_code TEXT,
  region_x NUMERIC DEFAULT 0,
  region_y NUMERIC DEFAULT 0,
  region_width NUMERIC DEFAULT 100,
  region_height NUMERIC DEFAULT 20,
  label TEXT,
  auto_matched BOOLEAN DEFAULT false
);

ALTER TABLE public.pdf_product_regions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view pdf regions" ON public.pdf_product_regions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can insert pdf regions" ON public.pdf_product_regions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated users can update pdf regions" ON public.pdf_product_regions FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Authenticated users can delete pdf regions" ON public.pdf_product_regions FOR DELETE TO authenticated USING (true);

-- Add columns to supplier_products
ALTER TABLE public.supplier_products ADD COLUMN IF NOT EXISTS pdf_page_id UUID REFERENCES public.supplier_pdf_pages(id) ON DELETE SET NULL;
