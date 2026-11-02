-- Dummy schema for invoice_mark_sent tests (PGlite). Only what the real functions touch. No real data.
CREATE SCHEMA auth; CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true),'')::uuid $$;
CREATE SCHEMA net; CREATE TABLE net.calls(id bigserial primary key, url text, body jsonb);
CREATE FUNCTION net.http_post(url text, headers jsonb, body jsonb) RETURNS bigint LANGUAGE sql AS $$ INSERT INTO net.calls(url,body) VALUES (url,body) RETURNING id $$;
CREATE TABLE companies(id uuid primary key, name text, accounts_email text);
CREATE TABLE company_profiles(id uuid, company_id uuid, logo_url text, archived_at timestamptz, is_default boolean, created_at timestamptz);
CREATE TABLE company_members(user_id uuid, company_id uuid, role text);
CREATE TABLE customers(id uuid primary key, email text, first_name text, last_name text, name text);
CREATE TABLE quotes(id uuid primary key, quote_number text, public_token uuid);
CREATE TABLE invoices(id uuid primary key, company_id uuid, invoice_number text, status text default 'draft', customer_id uuid, customer_name text, customer_email text,
  quote_id uuid, grand_total numeric, notes text, sent_at timestamptz, sent_method text, sent_channel text, sent_note text, sent_by uuid, updated_at timestamptz);
CREATE TABLE invoice_items(invoice_id uuid, description text, quantity numeric, unit_price numeric);
CREATE TABLE payments(id uuid, invoice_id uuid, company_id uuid, status text, reference text);
CREATE TABLE app_webhook_config(id int, email_webhook_token uuid); INSERT INTO app_webhook_config VALUES (1, gen_random_uuid());
CREATE TABLE email_events(email_id text, event_type text, recipient_email text, quote_number text, event_data jsonb);
CREATE TABLE entity_outbox(id bigserial, entity text, entity_id uuid, payload jsonb);
CREATE TABLE push_outbox(id bigserial, user_id uuid, payload jsonb);
-- stand-in for "anything that queues an outbound message when an invoice changes": records into entity_outbox unless skip flag on
CREATE FUNCTION _test_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF COALESCE(current_setting('app.invoice_skip_email', true),'') <> 'on' THEN INSERT INTO entity_outbox(entity,entity_id) VALUES ('invoice_sent',NEW.id); END IF; RETURN NEW; END $$;
CREATE TABLE notifications(id uuid primary key default gen_random_uuid(), user_id uuid, type text, title text, body text, related_id uuid, metadata jsonb);
CREATE TABLE bot_proposed_changes(id uuid primary key default gen_random_uuid(), company_id uuid, proposer_id uuid, action_type text, target_table text, target_id uuid,
  payload jsonb, summary text, reason text, checked_note text, status text default 'pending', reviewer_id uuid, reviewed_at timestamptz, review_note text, result jsonb, applied_at timestamptz);
CREATE TABLE bot_audit(co uuid, action text, payload jsonb);
CREATE FUNCTION fmt_rand_sql(numeric) RETURNS text LANGUAGE sql AS $$ SELECT 'R ' || $1::text $$;
CREATE FUNCTION is_accounts_bot(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT u = current_setting('test.bot')::uuid $$;
CREATE FUNCTION accounts_bot_company() RETURNS uuid LANGUAGE sql AS $$ SELECT CASE WHEN auth.uid() = current_setting('test.bot')::uuid THEN current_setting('test.botco')::uuid END $$;
CREATE FUNCTION is_sales_rep(u uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION fl_is_company_admin(u uuid, c uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT exists(select 1 from company_members where user_id=u and company_id=c and role='admin') $$;
CREATE FUNCTION caller_company_id() RETURNS uuid LANGUAGE sql AS $$ SELECT company_id FROM company_members WHERE user_id=auth.uid() LIMIT 1 $$;
CREATE FUNCTION _bot_audit(co uuid, a text, t text, i uuid, o jsonb, n jsonb, pid uuid DEFAULT NULL) RETURNS void LANGUAGE sql AS $$ INSERT INTO bot_audit VALUES (co,a,n) $$;
CREATE FUNCTION invoice_send_now(uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"resent":true}'::jsonb $$;
-- live _walda_co and _bpc_admin_check (copied verbatim, 2026-11-02)
CREATE FUNCTION public._walda_co() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE co uuid := public.accounts_bot_company();
BEGIN IF co IS NULL THEN RAISE EXCEPTION 'not allowed' USING ERRCODE='42501'; END IF; RETURN co; END $function$;
CREATE FUNCTION public._bpc_admin_check(p_co uuid) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$ BEGIN IF auth.uid() IS NULL OR public.is_accounts_bot(auth.uid()) OR public.is_sales_rep(auth.uid()) OR NOT public.fl_is_company_admin(auth.uid(), p_co) OR p_co IS DISTINCT FROM public.caller_company_id() THEN RAISE EXCEPTION 'Only an admin can review WALDA''s proposals' USING ERRCODE='42501'; END IF; END $function$;
