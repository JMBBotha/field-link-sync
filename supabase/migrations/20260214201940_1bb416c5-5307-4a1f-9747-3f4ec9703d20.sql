
-- Add INSERT and UPDATE policies for authenticated users on supplier_products
-- This ensures imports work for any logged-in user, not just admin role
CREATE POLICY "Authenticated users can insert supplier products"
ON public.supplier_products
FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update supplier products"
ON public.supplier_products
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Authenticated users can delete supplier products"
ON public.supplier_products
FOR DELETE
TO authenticated
USING (true);
