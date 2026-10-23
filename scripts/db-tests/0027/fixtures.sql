-- Two companies; A has an admin and a non-admin, B has an admin.
INSERT INTO public.companies (id, name, slug) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001','Co A','co-a'), ('bbbbbbbb-0000-0000-0000-000000000001','Co B','co-b');
INSERT INTO public.profiles (id, company_id, full_name) VALUES
 ('aaaaaaaa-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001','Admin A'),
 ('aaaaaaaa-0000-0000-0000-0000000000d1','aaaaaaaa-0000-0000-0000-000000000001','Office A'),
 ('bbbbbbbb-0000-0000-0000-0000000000a1','bbbbbbbb-0000-0000-0000-000000000001','Admin B');
INSERT INTO public.user_roles (user_id, role) VALUES
 ('aaaaaaaa-0000-0000-0000-0000000000a1','admin'), ('aaaaaaaa-0000-0000-0000-0000000000d1','dispatcher'),
 ('bbbbbbbb-0000-0000-0000-0000000000a1','admin');
INSERT INTO public.customers (id, company_id, name) VALUES ('cccccccc-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','TEST client');
INSERT INTO public.leads (id, company_id) VALUES
 ('11111111-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001'),
 ('11111111-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001');

-- Q1: draft, lead L1 (only quote), with children, a never-sent draft invoice + approval + event, bundle, photos.
INSERT INTO public.quotes (id, company_id, customer_id, lead_id, quote_number, status, sales_engineer_id) VALUES
 ('22222222-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001','Q-T-0001','draft','aaaaaaaa-0000-0000-0000-0000000000d1');
INSERT INTO public.quote_areas (id, quote_id, name) VALUES ('33333333-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001','Lounge');
INSERT INTO public.quote_items (quote_id, area_id, description) VALUES
 ('22222222-0000-0000-0000-000000000001','33333333-0000-0000-0000-000000000001','Unit'),
 ('22222222-0000-0000-0000-000000000001','33333333-0000-0000-0000-000000000001','Labour');
INSERT INTO public.quote_attachments (quote_id, storage_path) VALUES ('22222222-0000-0000-0000-000000000001','q1/photo.jpg');
INSERT INTO public.quote_documents (quote_id, storage_path) VALUES ('22222222-0000-0000-0000-000000000001','q1/doc.pdf');
INSERT INTO public.invoices (id, company_id, quote_id, invoice_number, status) VALUES
 ('44444444-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001','INV-T1','draft');
INSERT INTO public.invoice_send_approvals (id, invoice_id, quote_id, company_id, status) VALUES
 ('55555555-0000-0000-0000-000000000001','44444444-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','pending');
INSERT INTO public.invoice_send_events (approval_id, invoice_id, action) VALUES ('55555555-0000-0000-0000-000000000001','44444444-0000-0000-0000-000000000001','queued');
INSERT INTO public.notifications (user_id, type, title, related_id) VALUES
 ('aaaaaaaa-0000-0000-0000-0000000000a1','quote_viewed','Q1 viewed','22222222-0000-0000-0000-000000000001'),
 ('aaaaaaaa-0000-0000-0000-0000000000a1','quote_accepted_send_invoice','INV-T1 ready','44444444-0000-0000-0000-000000000001');
INSERT INTO public.notifications (user_id, type, title, metadata) VALUES
 ('aaaaaaaa-0000-0000-0000-0000000000d1','nudge','Q1 nudge', jsonb_build_object('quote_id','22222222-0000-0000-0000-000000000001'));
INSERT INTO public.notifications (user_id, type, title, related_id) VALUES
 ('aaaaaaaa-0000-0000-0000-0000000000a1','other','Unrelated', gen_random_uuid());
INSERT INTO public.job_photos (lead_id, storage_path, annotated_path) VALUES ('11111111-0000-0000-0000-000000000001','l1/a.jpg','l1/a-annot.jpg');
INSERT INTO public.quote_bundles (id, company_id, quote_ids) VALUES ('66666666-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
 ARRAY['22222222-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000003']::uuid[]);

-- Q2: accepted, issued invoice + payment, open follow-up and recent -> must refuse delete, archive instead.
INSERT INTO public.quotes (id, company_id, customer_id, quote_number, status, sales_engineer_id, accepted_at, sent_at, viewed_at, updated_at,
                           followup_state, followup_next_at, locked_at) VALUES
 ('22222222-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','Q-T-0002','accepted',
  'aaaaaaaa-0000-0000-0000-0000000000d1', now() - interval '10 days', now() - interval '12 days', now() - interval '11 days', now(),
  'quoted', now() - interval '1 day', NULL);
INSERT INTO public.quote_items (quote_id, description) VALUES ('22222222-0000-0000-0000-000000000002','Locked item');
UPDATE public.quotes SET locked_at = now() WHERE id = '22222222-0000-0000-0000-000000000002';
INSERT INTO public.invoices (id, company_id, quote_id, invoice_number, status, sent_at) VALUES
 ('44444444-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000002','INV-T2','sent', now());
INSERT INTO public.payments (invoice_id, amount) VALUES ('44444444-0000-0000-0000-000000000002', 100);
INSERT INTO public.notifications (user_id, type, title, related_id, read) VALUES
 ('aaaaaaaa-0000-0000-0000-0000000000a1','quote_accepted','Q2 accepted','22222222-0000-0000-0000-000000000002', false);

-- Q3: sent, open follow-up (for the cron filters), no money -> deletable; lead L2 shared with Q4 so photos are not offered.
INSERT INTO public.quotes (id, company_id, customer_id, lead_id, quote_number, status, sales_engineer_id, sent_at, updated_at, followup_state, followup_next_at) VALUES
 ('22222222-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000002','Q-T-0003','sent',
  'aaaaaaaa-0000-0000-0000-0000000000d1', now() - interval '10 days', now(), 'quoted', now() - interval '1 day'),
 ('22222222-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000002','Q-T-0004','draft',
  NULL, NULL, now(), NULL, NULL);
INSERT INTO public.job_photos (lead_id, storage_path) VALUES ('11111111-0000-0000-0000-000000000002','l2/b.jpg');

-- Q5: draft with a job -> refuse.
INSERT INTO public.quotes (id, company_id, customer_id, quote_number, status) VALUES
 ('22222222-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001','Q-T-0005','draft');
INSERT INTO public.jobs (company_id, quote_id, title) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000005','Install');
