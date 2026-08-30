ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_dispatch_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_dispatch_role_check
  CHECK (dispatch_role IS NULL OR dispatch_role = ANY (ARRAY['sales'::text, 'sales_engineer'::text, 'technician'::text]));