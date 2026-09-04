-- proposals
DROP POLICY IF EXISTS "Authenticated users can view proposals" ON public.proposals;
DROP POLICY IF EXISTS "Authenticated users can insert proposals" ON public.proposals;
DROP POLICY IF EXISTS "Authenticated users can update proposals" ON public.proposals;
DROP POLICY IF EXISTS "Authenticated users can delete proposals" ON public.proposals;

CREATE POLICY "Company can view proposals" ON public.proposals FOR SELECT TO authenticated
USING (company_id = public.get_user_company_id(auth.uid()));
CREATE POLICY "Company can insert proposals" ON public.proposals FOR INSERT TO authenticated
WITH CHECK (company_id = public.get_user_company_id(auth.uid()));
CREATE POLICY "Company can update proposals" ON public.proposals FOR UPDATE TO authenticated
USING (company_id = public.get_user_company_id(auth.uid()))
WITH CHECK (company_id = public.get_user_company_id(auth.uid()));
CREATE POLICY "Company can delete proposals" ON public.proposals FOR DELETE TO authenticated
USING (company_id = public.get_user_company_id(auth.uid()));

-- proposal_items (scoped through parent proposal)
DROP POLICY IF EXISTS "Authenticated users can view proposal_items" ON public.proposal_items;
DROP POLICY IF EXISTS "Authenticated users can insert proposal_items" ON public.proposal_items;
DROP POLICY IF EXISTS "Authenticated users can update proposal_items" ON public.proposal_items;
DROP POLICY IF EXISTS "Authenticated users can delete proposal_items" ON public.proposal_items;

CREATE POLICY "Company can view proposal_items" ON public.proposal_items FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.proposals p WHERE p.id = proposal_id AND p.company_id = public.get_user_company_id(auth.uid())));
CREATE POLICY "Company can insert proposal_items" ON public.proposal_items FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.proposals p WHERE p.id = proposal_id AND p.company_id = public.get_user_company_id(auth.uid())));
CREATE POLICY "Company can update proposal_items" ON public.proposal_items FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.proposals p WHERE p.id = proposal_id AND p.company_id = public.get_user_company_id(auth.uid())))
WITH CHECK (EXISTS (SELECT 1 FROM public.proposals p WHERE p.id = proposal_id AND p.company_id = public.get_user_company_id(auth.uid())));
CREATE POLICY "Company can delete proposal_items" ON public.proposal_items FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.proposals p WHERE p.id = proposal_id AND p.company_id = public.get_user_company_id(auth.uid())));

-- communication_log
DROP POLICY IF EXISTS "Authenticated users can view communication logs" ON public.communication_log;
CREATE POLICY "Company can view communication logs" ON public.communication_log FOR SELECT TO authenticated
USING (
  agent_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_id AND c.company_id = public.get_user_company_id(auth.uid()))
  OR EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_id AND l.company_id = public.get_user_company_id(auth.uid()))
);

-- customer_units
DROP POLICY IF EXISTS "Authenticated users can view customer units" ON public.customer_units;
DROP POLICY IF EXISTS "Admins and agents can create customer units" ON public.customer_units;
DROP POLICY IF EXISTS "Admins and agents can update customer units" ON public.customer_units;

CREATE POLICY "Company can view customer units" ON public.customer_units FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_id AND c.company_id = public.get_user_company_id(auth.uid())));
CREATE POLICY "Company can create customer units" ON public.customer_units FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_id AND c.company_id = public.get_user_company_id(auth.uid())));
CREATE POLICY "Company can update customer units" ON public.customer_units FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_id AND c.company_id = public.get_user_company_id(auth.uid())))
WITH CHECK (EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_id AND c.company_id = public.get_user_company_id(auth.uid())));

-- customer_feedback
DROP POLICY IF EXISTS "Authenticated users can view feedback" ON public.customer_feedback;
CREATE POLICY "Company can view feedback" ON public.customer_feedback FOR SELECT TO authenticated
USING (
  agent_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_id AND c.company_id = public.get_user_company_id(auth.uid()))
  OR EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_id AND l.company_id = public.get_user_company_id(auth.uid()))
);