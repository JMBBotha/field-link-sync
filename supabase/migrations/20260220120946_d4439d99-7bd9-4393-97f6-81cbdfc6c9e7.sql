
-- Public read + insert on fb_invoices
CREATE POLICY "public_read" ON public.fb_invoices FOR SELECT USING (true);
CREATE POLICY "public_insert" ON public.fb_invoices FOR INSERT WITH CHECK (true);

-- Public read + insert on fb_estimates
CREATE POLICY "public_read" ON public.fb_estimates FOR SELECT USING (true);
CREATE POLICY "public_insert" ON public.fb_estimates FOR INSERT WITH CHECK (true);

-- Public read + insert on fb_expenses
CREATE POLICY "public_read" ON public.fb_expenses FOR SELECT USING (true);
CREATE POLICY "public_insert" ON public.fb_expenses FOR INSERT WITH CHECK (true);

-- Public read + insert on fb_contacts
CREATE POLICY "public_read" ON public.fb_contacts FOR SELECT USING (true);
CREATE POLICY "public_insert" ON public.fb_contacts FOR INSERT WITH CHECK (true);

-- Public read + insert on fb_projects
CREATE POLICY "public_read" ON public.fb_projects FOR SELECT USING (true);
CREATE POLICY "public_insert" ON public.fb_projects FOR INSERT WITH CHECK (true);

-- Public read + insert on fb_payments
CREATE POLICY "public_read" ON public.fb_payments FOR SELECT USING (true);
CREATE POLICY "public_insert" ON public.fb_payments FOR INSERT WITH CHECK (true);

-- Public read + insert on fb_time_entries
CREATE POLICY "public_read" ON public.fb_time_entries FOR SELECT USING (true);
CREATE POLICY "public_insert" ON public.fb_time_entries FOR INSERT WITH CHECK (true);

-- Public read on companies (needed to resolve company by ID)
CREATE POLICY "public_read" ON public.companies FOR SELECT USING (true);
