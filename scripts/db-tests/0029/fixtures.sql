-- Fake data only. Co A: admin, sales rep, technician, office (dispatcher). Co B: admin.
INSERT INTO public.companies (id, name, slug) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001','Co A','co-a'), ('bbbbbbbb-0000-0000-0000-000000000001','Co B','co-b');
INSERT INTO public.profiles (id, company_id, full_name, dispatch_role) VALUES
 ('aaaaaaaa-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001','Admin A', NULL),
 ('aaaaaaaa-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-000000000001','Rep A','sales'),
 ('aaaaaaaa-0000-0000-0000-0000000000f1','aaaaaaaa-0000-0000-0000-000000000001','Tech A','technician'),
 ('aaaaaaaa-0000-0000-0000-0000000000d1','aaaaaaaa-0000-0000-0000-000000000001','Office A','dispatcher'),
 ('bbbbbbbb-0000-0000-0000-0000000000a1','bbbbbbbb-0000-0000-0000-000000000001','Admin B', NULL);
INSERT INTO public.user_roles (user_id, role) VALUES
 ('aaaaaaaa-0000-0000-0000-0000000000a1','admin'), ('aaaaaaaa-0000-0000-0000-0000000000e1','dispatcher'),
 ('aaaaaaaa-0000-0000-0000-0000000000f1','field_agent'), ('aaaaaaaa-0000-0000-0000-0000000000d1','dispatcher'),
 ('bbbbbbbb-0000-0000-0000-0000000000a1','admin');
INSERT INTO public.customers (id, company_id, name, vat_number, address, primary_address_line1, city, email) VALUES
 ('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','TEST Builders','4000000001','1 Old Rd, Cape Town','1 Old Rd','Cape Town','a@test.invalid'),
 ('cccccccc-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','TEST Draft Only','4000000002',NULL,NULL,NULL,NULL);

-- Q1 draft (rep's), Q2 sent (to be accepted by link), Q3 accepted not locked (pre-0029) + draft invoice,
-- Q4 accepted + SENT invoice, Q5 accepted + site-check lock.
INSERT INTO public.quotes (id, company_id, customer_id, customer_name, quote_number, status, sales_engineer_id, public_token, accepted_at, locked_at, locked_reason, vat_rate) VALUES
 ('22222222-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000002','TEST Draft Only','Q-T-0001','draft','aaaaaaaa-0000-0000-0000-0000000000e1',NULL,NULL,NULL,NULL,0.15),
 ('22222222-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','TEST Builders','Q-T-0002','sent','aaaaaaaa-0000-0000-0000-0000000000e1','99999999-0000-0000-0000-000000000002',NULL,NULL,NULL,0.15),
 ('22222222-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','TEST Builders','Q-T-0003','accepted','aaaaaaaa-0000-0000-0000-0000000000e1',NULL,'2026-10-16 08:55+02',NULL,NULL,0.15),
 ('22222222-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','TEST Builders','Q-T-0004','accepted','aaaaaaaa-0000-0000-0000-0000000000e1',NULL,'2026-10-16 08:55+02',NULL,NULL,0.15),
 ('22222222-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','TEST Builders','Q-T-0005','accepted','aaaaaaaa-0000-0000-0000-0000000000e1',NULL,now(),now(),'site_check_as_quoted',0.15);
INSERT INTO public.quote_areas (id, quote_id, name) VALUES
 ('33333333-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001','Lounge'),
 ('33333333-0000-0000-0000-000000000003','22222222-0000-0000-0000-000000000003','Office'),
 ('33333333-0000-0000-0000-000000000004','22222222-0000-0000-0000-000000000004','Server room');
SELECT set_config('app.quote_lock_bypass','on',false);
INSERT INTO public.quote_items (id, quote_id, area_id, description, unit_price, quantity) VALUES
 ('77777777-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001','33333333-0000-0000-0000-000000000001','Unit',1000,1),
 ('77777777-0000-0000-0000-000000000003','22222222-0000-0000-0000-000000000003','33333333-0000-0000-0000-000000000003','Unit',8130.82,1),
 ('77777777-0000-0000-0000-000000000004','22222222-0000-0000-0000-000000000004','33333333-0000-0000-0000-000000000004','Unit',5000,1),
 ('77777777-0000-0000-0000-000000000005','22222222-0000-0000-0000-000000000005',NULL,'Unit',3000,1);
SELECT set_config('app.quote_lock_bypass','',false);
INSERT INTO public.quote_line_items (quote_id, description, quantity, unit_price, total) VALUES ('22222222-0000-0000-0000-000000000003','Legacy line',1,10,10);
INSERT INTO public.proposal_sections (quote_id, section_type, title) VALUES ('22222222-0000-0000-0000-000000000003','text','Scope');
INSERT INTO public.invoices (id, company_id, quote_id, customer_id, invoice_number, status, grand_total) VALUES
 ('44444444-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000003','cccccccc-0000-0000-0000-000000000001','INV-T3','draft',9350.44),
 ('44444444-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000004','cccccccc-0000-0000-0000-000000000001','INV-T4','sent',5750);
