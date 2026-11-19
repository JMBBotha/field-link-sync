-- One isolated fake company for the UX designer. Every name, phone, and address is made up.
-- Inserts only. Does not update or delete any existing company, and does not call
-- the shared quote or invoice number generators, so those sequences stay put.
-- Quote and invoice numbers use the DEMO- prefix and are written explicitly.
-- Do not apply this file to the live project until Johan says so.
--
-- Go-live login (run later, password comes from the vault, never from this file):
--   SELECT public.create_demo_viewer_login('designer@fieldlynk-demo.example', p_password);
-- The caller must be the service role, or a Massair CT admin. The email argument must be
-- an example-domain address. The function creates auth.users + profile + the viewer role
-- on this demo company only.

CREATE OR REPLACE FUNCTION public.create_demo_viewer_login(p_email text, p_password text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_co uuid := 'd390de40-0000-4000-8000-000000000001';
  v_id uuid;
  v_hash text;
  v_existing uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT (
       public.has_role(auth.uid(), 'platform_super_admin'::public.app_role)
       OR (public.has_role(auth.uid(), 'admin'::public.app_role) AND public.is_master_company_user(auth.uid()))
     ) THEN
    RAISE EXCEPTION 'Only a Massair CT admin can create the demo viewer login'
      USING ERRCODE = '42501';
  END IF;
  IF public.is_readonly_viewer(auth.uid()) THEN
    RAISE EXCEPTION 'This login is view-only. It cannot change or send anything.'
      USING ERRCODE = '42501';
  END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Email is required';
  END IF;
  IF v_email !~ '@(fieldlynk-demo\.example|example\.(com|org|test))$' THEN
    RAISE EXCEPTION 'Demo login email must use an example domain';
  END IF;
  IF p_password IS NULL OR length(p_password) < 10 THEN
    RAISE EXCEPTION 'Password is required (at least 10 characters) and is not stored in source';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = v_co AND c.is_demo IS TRUE AND c.is_master IS FALSE) THEN
    RAISE EXCEPTION 'Demo company is missing';
  END IF;

  BEGIN
    v_hash := extensions.crypt(p_password, extensions.gen_salt('bf'));
  EXCEPTION WHEN undefined_function THEN
    v_hash := public.crypt(p_password, public.gen_salt('bf'));
  END;

  SELECT id INTO v_existing FROM auth.users WHERE lower(email) = v_email LIMIT 1;
  IF v_existing IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = v_existing
        AND p.company_id IS NOT NULL
        AND p.company_id IS DISTINCT FROM v_co
    ) THEN
      RAISE EXCEPTION 'That email already belongs to another company';
    END IF;
    v_id := v_existing;
    UPDATE auth.users
       SET encrypted_password = v_hash,
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           updated_at = now()
     WHERE id = v_id;
  ELSE
    v_id := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_id,
      'authenticated',
      'authenticated',
      v_email,
      v_hash,
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', 'Demo designer'),
      now(),
      now(),
      '',
      '',
      '',
      ''
    );
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'auth' AND table_name = 'identities' AND column_name = 'provider_id'
    ) THEN
      INSERT INTO auth.identities (
        id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), v_id,
        jsonb_build_object('sub', v_id::text, 'email', v_email),
        'email', v_id::text, now(), now(), now()
      );
    ELSE
      INSERT INTO auth.identities (
        id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), v_id,
        jsonb_build_object('sub', v_id::text, 'email', v_email),
        'email', now(), now(), now()
      );
    END IF;
  END IF;

  PERFORM set_config('app.approving_signup', 'on', true);
  INSERT INTO public.profiles (id, full_name, company_id, onboarding_completed, network_status)
  VALUES (v_id, 'Demo designer', v_co, true, 'approved')
  ON CONFLICT (id) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        company_id = EXCLUDED.company_id,
        dispatch_role = NULL,
        onboarding_completed = true,
        network_status = 'approved',
        signup_role = NULL;
  DELETE FROM public.user_roles WHERE user_id = v_id AND role IS DISTINCT FROM 'viewer'::public.app_role;
  INSERT INTO public.user_roles (user_id, role) VALUES (v_id, 'viewer'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;
  INSERT INTO public.company_members (user_id, company_id, role)
  VALUES (v_id, v_co, 'member')
  ON CONFLICT (user_id, company_id) DO UPDATE SET role = 'member';
  DELETE FROM public.company_members WHERE user_id = v_id AND company_id IS DISTINCT FROM v_co;
  PERFORM set_config('app.approving_signup', 'off', true);
  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.create_demo_viewer_login(text, text) IS
  'Creates or refreshes the view-only designer on the Field Lynk Demo UX company. Password is an argument and is never stored in source. Service role or a Massair CT admin only.';

REVOKE ALL ON FUNCTION public.create_demo_viewer_login(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_demo_viewer_login(text, text) TO authenticated, service_role;

-- Fixed id so the login RPC and the seed always mean the same company.
INSERT INTO public.companies (
  id, name, slug, is_master, is_demo, status, onboarding_completed,
  mandy_enabled, billing_live, office_address, accounts_email, vat_rate
) VALUES (
  'd390de40-0000-4000-8000-000000000001',
  'Field Lynk Demo UX',
  'field-lynk-demo-ux',
  false,
  true,
  'active',
  true,
  false,
  false,
  '14 Example Street, Stellenbosch, 7600 (FAKE — not a real site)',
  'office@fieldlynk-demo.example',
  0.15
)
ON CONFLICT (id) DO NOTHING;

-- Staff id used on quotes and invoices. No auth user, and quotes.sales_engineer_id has no FK.
-- The designer login is a different person, created later by create_demo_viewer_login.
DO $$
DECLARE
  co uuid := 'd390de40-0000-4000-8000-000000000001';
  staff uuid := 'd390de40-0000-4000-8000-0000000000aa';
  c1 uuid := 'd390de40-0000-4000-8000-000000000011';
  c2 uuid := 'd390de40-0000-4000-8000-000000000012';
  c3 uuid := 'd390de40-0000-4000-8000-000000000013';
  c4 uuid := 'd390de40-0000-4000-8000-000000000014';
  c5 uuid := 'd390de40-0000-4000-8000-000000000015';
  l1 uuid := 'd390de40-0000-4000-8000-000000000021';
  l2 uuid := 'd390de40-0000-4000-8000-000000000022';
  l3 uuid := 'd390de40-0000-4000-8000-000000000023';
  l4 uuid := 'd390de40-0000-4000-8000-000000000024';
  l5 uuid := 'd390de40-0000-4000-8000-000000000025';
  l6 uuid := 'd390de40-0000-4000-8000-000000000026';
  q1 uuid := 'd390de40-0000-4000-8000-000000000031';
  q2 uuid := 'd390de40-0000-4000-8000-000000000032';
  q3 uuid := 'd390de40-0000-4000-8000-000000000033';
  q4 uuid := 'd390de40-0000-4000-8000-000000000034';
  j1 uuid := 'd390de40-0000-4000-8000-000000000041';
  j2 uuid := 'd390de40-0000-4000-8000-000000000042';
  j3 uuid := 'd390de40-0000-4000-8000-000000000043';
  i1 uuid := 'd390de40-0000-4000-8000-000000000051';
  i2 uuid := 'd390de40-0000-4000-8000-000000000052';
  i3 uuid := 'd390de40-0000-4000-8000-000000000053';
  i4 uuid := 'd390de40-0000-4000-8000-000000000054';
  p1 uuid := 'd390de40-0000-4000-8000-000000000061';
  p2 uuid := 'd390de40-0000-4000-8000-000000000062';
  t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = co AND is_demo IS TRUE AND is_master IS FALSE) THEN
    RAISE EXCEPTION 'Refusing to seed demo data: company % is not the demo company', co;
  END IF;

  FOREACH t IN ARRAY ARRAY['customers', 'leads', 'quotes', 'quote_items', 'jobs', 'invoices', 'invoice_items', 'payments']
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', t);
    END IF;
  END LOOP;

  INSERT INTO public.customers (id, company_id, name, first_name, last_name, phone, email, address, city, latitude, longitude, notes)
  VALUES
    (c1, co, 'Amahle Dlamini (FAKE)', 'Amahle', 'Dlamini', '0800001001', 'amahle.fake@fieldlynk-demo.example', '14 Example Street, Stellenbosch (FAKE)', 'Stellenbosch', -33.9340, 18.8600, 'FAKE demo client'),
    (c2, co, 'Pieter van Tonder (FAKE)', 'Pieter', 'van Tonder', '0800001002', 'pieter.fake@fieldlynk-demo.example', '8 Sample Road, Paarl (FAKE)', 'Paarl', -33.7340, 18.9620, 'FAKE demo client'),
    (c3, co, 'Naledi Khumalo (FAKE)', 'Naledi', 'Khumalo', '0800001003', 'naledi.fake@fieldlynk-demo.example', '3 Practice Lane, Somerset West (FAKE)', 'Somerset West', -34.0780, 18.8430, 'FAKE demo client'),
    (c4, co, 'Sipho Pretorius (FAKE)', 'Sipho', 'Pretorius', '0800001004', 'sipho.fake@fieldlynk-demo.example', '21 Tutorial Close, Strand (FAKE)', 'Strand', -34.1100, 18.8300, 'FAKE demo client'),
    (c5, co, 'Lerato Molefe (FAKE)', 'Lerato', 'Molefe', '0800001005', 'lerato.fake@fieldlynk-demo.example', '6 Placeholder Ave, Franschhoek (FAKE)', 'Franschhoek', -33.9130, 19.1200, 'FAKE demo client')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.leads (
    id, customer_name, customer_phone, phone, email, notes, service_type, status, source, primary_intent,
    customer_id, company_id, customer_address, latitude, longitude, created_at
  ) VALUES
    (l1, 'Amahle Dlamini (FAKE)', '0800001001', '0800001001', 'amahle.fake@fieldlynk-demo.example', 'FAKE new enquiry — bedroom split', 'New Installation', 'pending', 'manual', 'sales', c1, co, '14 Example Street, Stellenbosch (FAKE)', -33.9340, 18.8600, '2026-11-18 09:00:00+02'),
    (l2, 'Pieter van Tonder (FAKE)', '0800001002', '0800001002', 'pieter.fake@fieldlynk-demo.example', 'FAKE quote in draft', 'New Installation', 'pending', 'manual', 'sales', c2, co, '8 Sample Road, Paarl (FAKE)', -33.7340, 18.9620, '2026-11-12 10:00:00+02'),
    (l3, 'Naledi Khumalo (FAKE)', '0800001003', '0800001003', 'naledi.fake@fieldlynk-demo.example', 'FAKE quote sent, waiting on the client', 'New Installation', 'pending', 'manual', 'sales', c3, co, '3 Practice Lane, Somerset West (FAKE)', -34.0780, 18.8430, '2026-11-04 11:00:00+02'),
    (l4, 'Sipho Pretorius (FAKE)', '0800001004', '0800001004', 'sipho.fake@fieldlynk-demo.example', 'FAKE accepted quote, job not booked yet', 'New Installation', 'pending', 'manual', 'sales', c4, co, '21 Tutorial Close, Strand (FAKE)', -34.1100, 18.8300, '2026-11-02 08:30:00+02'),
    (l5, 'Lerato Molefe (FAKE)', '0800001005', '0800001005', 'lerato.fake@fieldlynk-demo.example', 'FAKE stale open lead', 'New Installation', 'pending', 'manual', 'sales', c5, co, '6 Placeholder Ave, Franschhoek (FAKE)', -33.9130, 19.1200, '2026-10-01 08:00:00+02'),
    (l6, 'Koos Example (FAKE)', '0800001006', '0800001006', 'koos.fake@fieldlynk-demo.example', 'FAKE cancelled lead — stays off Open leads', 'Repair', 'cancelled', 'manual', 'service', NULL, co, '1 Nowhere Road, Wellington (FAKE)', -33.6400, 19.0100, '2026-09-15 08:00:00+02')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.quotes (
    id, company_id, customer_id, lead_id, sales_engineer_id, status, quote_number,
    customer_name, subtotal, vat_rate, vat_amount, total, notes, created_at, sent_at, accepted_at, valid_until
  ) VALUES
    (q1, co, c2, l2, staff, 'draft', 'DEMO-Q-1001', 'Pieter van Tonder (FAKE)', 18400.00, 0.15, 2760.00, 21160.00, 'FAKE draft quote for a lounge split', '2026-11-12 10:30:00+02', NULL, NULL, '2026-12-12'),
    (q2, co, c3, l3, staff, 'sent', 'DEMO-Q-1002', 'Naledi Khumalo (FAKE)', 32600.00, 0.15, 4890.00, 37490.00, 'FAKE sent quote, waiting on the client', '2026-11-04 12:00:00+02', '2026-11-05 09:00:00+02', NULL, '2026-12-05'),
    (q3, co, c4, l4, staff, 'accepted', 'DEMO-Q-1003', 'Sipho Pretorius (FAKE)', 45200.00, 0.15, 6780.00, 51980.00, 'FAKE accepted quote, no job booked yet', '2026-11-02 09:00:00+02', '2026-11-02 15:00:00+02', '2026-11-08 11:00:00+02', '2026-12-02'),
    (q4, co, c5, l5, staff, 'draft', 'DEMO-Q-1004', 'Lerato Molefe (FAKE)', 12800.00, 0.15, 1920.00, 14720.00, 'FAKE old draft — archive candidate, not auto-archived', '2026-10-01 09:00:00+02', NULL, NULL, '2026-10-31')
  ON CONFLICT (id) DO NOTHING;

  IF to_regclass('public.quote_items') IS NOT NULL THEN
    INSERT INTO public.quote_items (id, quote_id, item_name, description, unit_price, quantity, total_price, item_type, sort_order, source, metadata)
    VALUES
      ('d390de40-0000-4000-8000-000000000071', q2, 'Midwall split 12000 BTU (FAKE)', 'FAKE indoor and outdoor unit', 18600.00, 1, 18600.00, 'unit', 1, 'manual', '{}'::jsonb),
      ('d390de40-0000-4000-8000-000000000072', q2, 'Install labour (FAKE)', 'FAKE standard install', 4500.00, 1, 4500.00, 'labour', 2, 'manual', '{}'::jsonb),
      ('d390de40-0000-4000-8000-000000000073', q2, 'Copper and trunking (FAKE)', 'FAKE 6 m piping kit', 9500.00, 1, 9500.00, 'material', 3, 'manual', '{}'::jsonb)
    ON CONFLICT (id) DO NOTHING;
  END IF;

  INSERT INTO public.jobs (
    id, company_id, customer_id, lead_id, quote_id, title, description, address, lat, lng,
    status, job_type, scheduled_for, started_at, completed_at
  ) VALUES
    (j1, co, c1, l1, NULL, 'Install — Amahle Dlamini (FAKE)', 'FAKE booked installation, not started', '14 Example Street, Stellenbosch (FAKE)', -33.9340, 18.8600, 'scheduled', 'installation', '2026-11-20 09:00:00+02', NULL, NULL),
    (j2, co, c3, NULL, NULL, 'Service — Naledi Khumalo (FAKE)', 'FAKE service visit on site today', '3 Practice Lane, Somerset West (FAKE)', -34.0780, 18.8430, 'in_progress', 'service', '2026-11-19 08:30:00+02', '2026-11-19 08:40:00+02', NULL),
    (j3, co, c2, NULL, NULL, 'Install — Pieter van Tonder (FAKE)', 'FAKE completed install last week', '8 Sample Road, Paarl (FAKE)', -33.7340, 18.9620, 'completed', 'installation', '2026-11-12 13:00:00+02', '2026-11-12 13:10:00+02', '2026-11-12 16:00:00+02')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.invoices (
    id, invoice_number, agent_id, customer_id, customer_name, customer_phone, customer_email, customer_address,
    quote_id, company_id, subtotal, tax_rate, tax_amount, grand_total, issue_date, status, line_items, notes,
    due_date, sent_at
  ) VALUES
    (i1, 'DEMO-INV-1001', staff, c2, 'Pieter van Tonder (FAKE)', '0800001002', 'pieter.fake@fieldlynk-demo.example', '8 Sample Road, Paarl (FAKE)',
      q1, co, 9200.00, 15, 1380.00, 10580.00, '2026-11-18', 'draft',
      '[{"description":"FAKE deposit draft — lounge split","quantity":1,"rate":9200,"amount":9200}]'::jsonb,
      'FAKE draft invoice, not emailed', NULL, NULL),
    (i2, 'DEMO-INV-1002', staff, c3, 'Naledi Khumalo (FAKE)', '0800001003', 'naledi.fake@fieldlynk-demo.example', '3 Practice Lane, Somerset West (FAKE)',
      q2, co, 16300.00, 15, 2445.00, 18745.00, '2026-11-06', 'sent',
      '[{"description":"FAKE deposit 50% — DEMO-Q-1002","quantity":1,"rate":16300,"amount":16300}]'::jsonb,
      'DEPOSIT — FAKE, already marked sent in the seed. Nothing was emailed by this migration.', '2026-11-13', '2026-11-06 10:00:00+02'),
    (i3, 'DEMO-INV-1003', staff, c4, 'Sipho Pretorius (FAKE)', '0800001004', 'sipho.fake@fieldlynk-demo.example', '21 Tutorial Close, Strand (FAKE)',
      q3, co, 22600.00, 15, 3390.00, 25990.00, '2026-10-20', 'sent',
      '[{"description":"FAKE final balance — DEMO-Q-1003","quantity":1,"rate":22600,"amount":22600}]'::jsonb,
      'FAKE final, overdue, not emailed by this migration', '2026-11-03', '2026-10-20 10:00:00+02'),
    (i4, 'DEMO-INV-1004', staff, c1, 'Amahle Dlamini (FAKE)', '0800001001', 'amahle.fake@fieldlynk-demo.example', '14 Example Street, Stellenbosch (FAKE)',
      NULL, co, 6400.00, 15, 960.00, 7360.00, '2026-11-01', 'paid',
      '[{"description":"FAKE service call-out","quantity":1,"rate":6400,"amount":6400}]'::jsonb,
      'FAKE paid service invoice', '2026-11-08', '2026-11-01 10:00:00+02')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.payments (
    id, invoice_id, company_id, amount, payment_date, method, reference, gateway, status, environment, currency
  ) VALUES
    (p1, i2, co, 8000.00, '2026-11-10', 'eft', 'FAKE-EFT-1002', 'manual', 'paid', 'test', 'ZAR'),
    (p2, i4, co, 7360.00, '2026-11-02', 'eft', 'FAKE-EFT-1004', 'manual', 'paid', 'test', 'ZAR')
  ON CONFLICT (id) DO NOTHING;

  FOREACH t IN ARRAY ARRAY['customers', 'leads', 'quotes', 'quote_items', 'jobs', 'invoices', 'invoice_items', 'payments']
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', t);
    END IF;
  END LOOP;
END $$;
