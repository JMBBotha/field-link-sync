-- Generated from the live Massair CT schema (structure only, no data) for local 0027 tests.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub','')::uuid $$;
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TYPE public.app_role AS ENUM ('admin', 'field_agent', 'dispatcher', 'viewer', 'platform_super_admin', 'platform_ops');
CREATE TYPE public.lead_classifier AS ENUM ('rule', 'ai', 'human');
CREATE TYPE public.lead_intent AS ENUM ('sales', 'service');
CREATE TYPE public.lead_lifecycle_status AS ENUM ('new', 'classified', 'routed', 'in_progress', 'completed', 'lost', 'cancelled', 'resolved_before_visit');
CREATE TYPE public.lead_priority_level AS ENUM ('emergency', 'same_day', 'standard');
CREATE TYPE public.lead_source AS ENUM ('vapi_call', 'website_form', 'facebook_lead_ads', 'google_lsa', 'manual', 'other', 'website_shop');
CREATE TYPE public.pricing_unit_type AS ENUM ('each', 'm', 'g', 'kg', 'l', 'ml', 'roll', 'box', 'pack', 'custom');
CREATE TABLE public.assignments (
  "id" uuid DEFAULT gen_random_uuid(),
  "job_id" uuid,
  "profile_id" uuid,
  "assigned_by" uuid,
  "assignment_type" text DEFAULT 'internal'::text,
  "status" text DEFAULT 'proposed'::text,
  "eta" timestamp with time zone,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "route_order" integer,
  "route_id" uuid,
  "travel_seconds" integer,
  "travel_meters" integer,
  "optimized_at" timestamp with time zone
);
CREATE TABLE public.audit_log (
  "id" uuid DEFAULT gen_random_uuid(),
  "table_name" text,
  "record_id" uuid,
  "action" text,
  "old_data" jsonb,
  "new_data" jsonb,
  "user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "company_id" uuid
);
CREATE TABLE public.cf_commitments (
  "id" uuid DEFAULT gen_random_uuid(),
  "company_id" uuid,
  "source_key" text,
  "invoice_id" uuid,
  "quote_id" uuid,
  "job_id" uuid,
  "project" text DEFAULT ''::text,
  "item" text,
  "kind" text DEFAULT 'unit'::text,
  "qty" numeric DEFAULT 1,
  "supplier" text,
  "unit_cost_excl" numeric DEFAULT 0,
  "vat_rate" numeric DEFAULT 15,
  "status" text DEFAULT 'needed'::text,
  "pay_date" date,
  "edited" boolean DEFAULT false,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.cf_receipts (
  "id" uuid DEFAULT gen_random_uuid(),
  "company_id" uuid,
  "source" text DEFAULT 'manual'::text,
  "source_key" text,
  "invoice_id" uuid,
  "quote_id" uuid,
  "ref" text DEFAULT ''::text,
  "client" text,
  "part" text DEFAULT 'full'::text,
  "amount_incl" numeric DEFAULT 0,
  "vat_incl" numeric DEFAULT 0,
  "expected_date" date,
  "leeway_days" integer DEFAULT 7,
  "confidence" integer DEFAULT 60,
  "status" text DEFAULT 'expected'::text,
  "received_date" date,
  "received_amount" numeric,
  "dates_edited" boolean DEFAULT false,
  "conf_edited" boolean DEFAULT false,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.cf_stock_allocations (
  "id" uuid DEFAULT gen_random_uuid(),
  "company_id" uuid,
  "stock_item_id" uuid,
  "commitment_id" uuid,
  "qty" numeric,
  "drawn_at" timestamp with time zone,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.change_order_line_items (
  "id" uuid DEFAULT gen_random_uuid(),
  "change_order_id" uuid,
  "type" text,
  "description" text,
  "quantity" numeric(10,2) DEFAULT 1,
  "unit_price" numeric(12,2) DEFAULT 0,
  "total" numeric(12,2) DEFAULT 0,
  "original_line_item_id" uuid,
  "sort_order" integer DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.change_orders (
  "id" uuid DEFAULT gen_random_uuid(),
  "quote_id" uuid,
  "accepted_quote_version_id" uuid,
  "job_id" uuid,
  "status" text DEFAULT 'draft'::text,
  "reason" text,
  "total_impact_ex_vat" numeric(12,2) DEFAULT 0,
  "total_impact_incl_vat" numeric(12,2) DEFAULT 0,
  "requested_by" text,
  "owner_id" uuid,
  "created_by" uuid,
  "accepted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.communication_log (
  "id" uuid DEFAULT gen_random_uuid(),
  "lead_id" uuid,
  "customer_id" uuid,
  "type" text,
  "subject" text,
  "body" text,
  "agent_id" uuid,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.companies (
  "id" uuid DEFAULT gen_random_uuid(),
  "name" text,
  "logo_url" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "slug" text DEFAULT ''::text,
  "onboarding_completed" boolean DEFAULT false,
  "services" text[],
  "default_rate" numeric DEFAULT 450,
  "vat_rate" numeric DEFAULT 15,
  "updated_at" timestamp with time zone DEFAULT now(),
  "status" text DEFAULT 'active'::text,
  "units_markup_percent" numeric DEFAULT 25,
  "materials_markup_percent" numeric DEFAULT 100,
  "labour_cost_per_hour" numeric,
  "gp_target_percent" numeric DEFAULT 20,
  "sales_commission_percent" numeric DEFAULT 50,
  "is_master" boolean DEFAULT false,
  "custom_service_limit" integer DEFAULT 5,
  "labour_tech_share_percent" numeric DEFAULT 60,
  "tech_split_mode" text DEFAULT 'even'::text,
  "tech_paid_on_completion_pct" numeric DEFAULT 40,
  "tech_holdback_pct" numeric DEFAULT 10,
  "tech_holdback_days" integer DEFAULT 45,
  "tools_retained_pct" numeric DEFAULT 10,
  "materials_waste_percent" numeric DEFAULT 10,
  "work_days" integer[],
  "work_start" time without time zone DEFAULT '08:00:00'::time without time zone,
  "work_end" time without time zone DEFAULT '17:00:00'::time without time zone,
  "office_address" text,
  "office_lat" double precision,
  "office_lng" double precision,
  "install_handoff_default" text DEFAULT 'manual'::text,
  "plan_code" text DEFAULT 'standard'::text,
  "plan_status" text DEFAULT 'pending_contract'::text,
  "plan_base_price_zar" numeric(10,2) DEFAULT 4500,
  "plan_included_users" integer DEFAULT 3,
  "plan_extra_user_price_zar" numeric(10,2) DEFAULT 149,
  "plan_contract_months" integer DEFAULT 36,
  "contract_signed_at" timestamp with time zone,
  "contract_signed_by" uuid,
  "contract_ends_at" timestamp with time zone,
  "plan_grace_until" timestamp with time zone,
  "mandy_enabled" boolean DEFAULT true,
  "billing_live" boolean DEFAULT false,
  "accounts_email" text
);
CREATE TABLE public.company_invoices (
  "id" uuid DEFAULT gen_random_uuid(),
  "company_id" uuid,
  "customer_id" uuid,
  "quote_id" uuid,
  "quote_number" text,
  "status" text DEFAULT 'Draft'::text,
  "invoice_number" text,
  "due_date" date,
  "subtotal" numeric DEFAULT 0,
  "vat_amount" numeric DEFAULT 0,
  "total_amount" numeric DEFAULT 0,
  "amount_paid" numeric DEFAULT 0,
  "recurrence" jsonb,
  "notes" text,
  "contact_id" uuid,
  "items" jsonb DEFAULT '[]'::jsonb,
  "tax" numeric DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.company_members (
  "id" uuid DEFAULT gen_random_uuid(),
  "user_id" uuid,
  "company_id" uuid,
  "role" text DEFAULT 'member'::text,
  "created_at" timestamp with time zone DEFAULT now(),
  "is_owner" boolean DEFAULT false
);
CREATE TABLE public.credit_notes (
  "id" uuid DEFAULT gen_random_uuid(),
  "company_id" uuid,
  "invoice_id" uuid,
  "customer_id" uuid,
  "credit_note_number" text,
  "issue_date" date,
  "reason" text,
  "description" text,
  "subtotal" numeric(12,2),
  "tax_rate" numeric,
  "tax_amount" numeric(12,2),
  "total" numeric(12,2),
  "status" text DEFAULT 'issued'::text,
  "void_reason" text,
  "voided_at" timestamp with time zone,
  "voided_by" uuid,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.customer_feedback (
  "id" uuid DEFAULT gen_random_uuid(),
  "customer_id" uuid,
  "lead_id" uuid,
  "agent_id" uuid,
  "rating" integer,
  "comment" text,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.customers (
  "id" uuid DEFAULT gen_random_uuid(),
  "name" text,
  "email" text,
  "phone" text,
  "address" text,
  "latitude" numeric,
  "longitude" numeric,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "created_by" uuid,
  "preferred_contact_method" text DEFAULT 'email'::text,
  "notification_opt_in" boolean DEFAULT true,
  "phone_verified" boolean DEFAULT false,
  "email_verified" boolean DEFAULT false,
  "area" text,
  "vat_number" text,
  "data_consent" boolean DEFAULT false,
  "data_consent_date" timestamp with time zone,
  "first_name" text,
  "last_name" text,
  "company_name" text,
  "is_company" boolean DEFAULT false,
  "secondary_phone" text,
  "primary_address_line1" text,
  "primary_address_line2" text,
  "city" text,
  "postal_code" text,
  "status" text DEFAULT 'lead'::text,
  "normalized_phone" text,
  "normalized_email" text,
  "company_id" uuid,
  "lead_source" text DEFAULT 'other'::text,
  "search_aliases" text[],
  "assigned_rep_id" uuid,
  "client_type" text,
  "payment_terms_basis" text,
  "payment_terms_days" integer
);
CREATE TABLE public.expenses (
  "id" uuid DEFAULT gen_random_uuid(),
  "company_id" uuid,
  "expense_date" date,
  "supplier_id" uuid,
  "supplier_name" text,
  "category" text DEFAULT 'other'::text,
  "description" text,
  "amount_incl" numeric(12,2),
  "vat_claimable" boolean DEFAULT true,
  "vat_rate" numeric(5,2) DEFAULT 0,
  "vat_amount" numeric(12,2) DEFAULT 0,
  "amount_excl" numeric(12,2) DEFAULT 0,
  "payment_method" text,
  "reference" text,
  "receipt_path" text,
  "job_id" uuid,
  "source" text DEFAULT 'manual'::text,
  "source_id" uuid,
  "status" text DEFAULT 'active'::text,
  "archived_at" timestamp with time zone,
  "archived_by" uuid,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.invoice_items (
  "id" uuid DEFAULT gen_random_uuid(),
  "invoice_id" uuid,
  "service_id" uuid,
  "description" text,
  "quantity" numeric DEFAULT 1,
  "unit_price" numeric DEFAULT 0,
  "amount" numeric DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now(),
  "line_name" text,
  "line_type" text DEFAULT 'item'::text,
  "room_label" text,
  "sort_order" integer DEFAULT 0,
  "vat_rate" numeric DEFAULT 15,
  "vat_amount" numeric,
  "product_id" uuid
);
CREATE TABLE public.invoice_requests (
  "id" uuid DEFAULT gen_random_uuid(),
  "company_id" uuid,
  "lead_id" uuid,
  "job_id" uuid,
  "quote_id" uuid,
  "technician_id" uuid,
  "customer_name" text,
  "as_quoted" boolean DEFAULT true,
  "extra_items" jsonb DEFAULT '[]'::jsonb,
  "extra_hours" numeric,
  "note" text,
  "started_at" timestamp with time zone,
  "finished_at" timestamp with time zone,
  "status" text DEFAULT 'pending'::text,
  "invoice_id" uuid,
  "approved_by" uuid,
  "approved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.invoice_send_approvals (
  "id" uuid DEFAULT gen_random_uuid(),
  "invoice_id" uuid,
  "quote_id" uuid,
  "company_id" uuid,
  "rep_id" uuid,
  "client_name" text,
  "quote_number" text,
  "invoice_number" text,
  "deposit_amount" numeric,
  "status" text DEFAULT 'pending'::text,
  "due_at" timestamp with time zone,
  "decision" text,
  "decided_by" uuid,
  "decided_at" timestamp with time zone,
  "hold_reason" text,
  "sent_at" timestamp with time zone,
  "attempts" integer DEFAULT 0,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.invoice_send_events (
  "id" bigserial,
  "approval_id" uuid,
  "invoice_id" uuid,
  "actor_id" uuid,
  "action" text,
  "note" text,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.invoices (
  "id" uuid DEFAULT gen_random_uuid(),
  "invoice_number" text,
  "lead_id" uuid,
  "agent_id" uuid,
  "customer_name" text,
  "customer_phone" text,
  "customer_address" text,
  "line_items" jsonb DEFAULT '[]'::jsonb,
  "subtotal" numeric(10,2) DEFAULT 0,
  "tax_rate" numeric(5,2) DEFAULT 15,
  "tax_amount" numeric(10,2) DEFAULT 0,
  "grand_total" numeric(10,2) DEFAULT 0,
  "payment_method" text,
  "notes" text,
  "status" text DEFAULT 'draft'::text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "equipment_id" uuid,
  "due_date" date,
  "paid_date" date,
  "customer_email" text,
  "customer_id" uuid,
  "issue_date" date,
  "pdf_url" text,
  "quote_id" uuid,
  "payfast_payment_id" text,
  "payfast_url" text,
  "template_id" uuid,
  "company_id" uuid,
  "location_id" uuid,
  "company_profile_id" uuid,
  "billed_to_vat_number" text,
  "discount_type" text,
  "discount_value" numeric,
  "discount_amount" numeric DEFAULT 0,
  "deposit_type" text,
  "deposit_value" numeric,
  "deposit_amount" numeric,
  "sent_at" timestamp with time zone,
  "profile_snapshot" jsonb,
  "duplicated_from" uuid,
  "sent_method" text,
  "sent_channel" text,
  "sent_note" text,
  "sent_by" uuid,
  "payment_terms_basis" text,
  "payment_terms_days" integer,
  "archived_at" timestamp with time zone
);
CREATE TABLE public.job_activity_log (
  "id" uuid DEFAULT gen_random_uuid(),
  "job_id" uuid,
  "user_id" uuid,
  "action" text,
  "details" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.job_alerts (
  "id" uuid DEFAULT gen_random_uuid(),
  "company_id" uuid,
  "job_id" uuid,
  "profile_id" uuid,
  "rule" text,
  "severity" text DEFAULT 'warning'::text,
  "message" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "resolved_at" timestamp with time zone,
  "resolved_by" uuid,
  "resolution" text
);
CREATE TABLE public.job_completions (
  "id" uuid DEFAULT gen_random_uuid(),
  "company_id" uuid,
  "lead_id" uuid,
  "job_id" uuid,
  "technician_id" uuid,
  "work_summary" text,
  "customer_name" text,
  "customer_email" text,
  "signature_data_url" text,
  "signed_at" timestamp with time zone,
  "parts_total" numeric DEFAULT 0,
  "labour_minutes" integer DEFAULT 0,
  "photo_count" integer DEFAULT 0,
  "status" text DEFAULT 'completed'::text,
  "completed_at" timestamp with time zone DEFAULT now(),
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.job_expenses (
  "id" uuid DEFAULT gen_random_uuid(),
  "lead_id" uuid,
  "description" text,
  "amount" numeric(10,2),
  "expense_date" date,
  "receipt_path" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.job_overruns (
  "id" uuid DEFAULT gen_random_uuid(),
  "job_id" uuid,
  "quote_id" uuid,
  "actual_hours" numeric,
  "extra_items" jsonb DEFAULT '[]'::jsonb,
  "notes" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "lead_id" uuid
);
CREATE TABLE public.job_photos (
  "id" uuid DEFAULT gen_random_uuid(),
  "lead_id" uuid,
  "storage_path" text,
  "caption" text,
  "uploaded_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "synced_from_offline" boolean DEFAULT false,
  "photo_type" text DEFAULT 'after'::text,
  "annotation" jsonb,
  "annotated_path" text,
  "client_visible" boolean DEFAULT false
);
CREATE TABLE public.job_schedules (
  "id" uuid DEFAULT gen_random_uuid(),
  "lead_id" uuid,
  "agent_id" uuid,
  "scheduled_date" date,
  "start_time" time without time zone,
  "end_time" time without time zone,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "route_order" integer,
  "route_id" uuid,
  "optimized_at" timestamp with time zone,
  "job_id" uuid
);
CREATE TABLE public.job_site_checks (
  "id" uuid DEFAULT gen_random_uuid(),
  "job_id" uuid,
  "quote_id" uuid,
  "company_id" uuid,
  "tech_id" uuid,
  "source" text DEFAULT 'tech_app'::text,
  "checklist" jsonb DEFAULT '{}'::jsonb,
  "result" text,
  "notes" text,
  "variation_quote_id" uuid,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.job_time_entries (
  "id" uuid DEFAULT gen_random_uuid(),
  "lead_id" uuid,
  "agent_id" uuid,
  "work_date" date,
  "start_time" time without time zone,
  "end_time" time without time zone,
  "hours_onsite" numeric(5,2),
  "travel_hours" numeric(5,2) DEFAULT 0,
  "is_billable" boolean DEFAULT true,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.job_used_parts (
  "id" uuid DEFAULT gen_random_uuid(),
  "lead_id" uuid,
  "product_id" uuid,
  "product_code" text,
  "product_name" text,
  "unit_cost" numeric DEFAULT 0,
  "quantity" integer DEFAULT 1,
  "line_total" numeric,
  "added_by" uuid,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.job_variations (
  "id" uuid DEFAULT gen_random_uuid(),
  "job_id" uuid,
  "company_id" uuid,
  "original_quote_id" uuid,
  "variation_quote_id" uuid,
  "site_check_id" uuid,
  "source" text DEFAULT 'tech_app'::text,
  "created_by" uuid,
  "items" jsonb DEFAULT '[]'::jsonb,
  "unit_swaps" jsonb DEFAULT '[]'::jsonb,
  "needs_pricing" boolean DEFAULT false,
  "status" text DEFAULT 'awaiting_pricing'::text,
  "decided_by" text,
  "decided_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.jobs (
  "id" uuid DEFAULT gen_random_uuid(),
  "company_id" uuid,
  "customer_id" uuid,
  "lead_id" uuid,
  "quote_id" uuid,
  "title" text,
  "description" text,
  "address" text,
  "lat" numeric,
  "lng" numeric,
  "scheduled_for" timestamp with time zone,
  "estimated_duration" interval DEFAULT '03:00:00'::interval,
  "priority" text DEFAULT 'normal'::text,
  "status" text DEFAULT 'scheduled'::text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "job_type" text DEFAULT 'service'::text,
  "location_id" uuid,
  "invoice_id" uuid,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "awaiting_stock" boolean DEFAULT false,
  "site_check_status" text,
  "variation_quote_id" uuid
);
CREATE TABLE public.lead_call_attempts (
  "id" uuid DEFAULT gen_random_uuid(),
  "company_id" uuid,
  "lead_id" uuid,
  "profile_id" uuid,
  "person_name" text,
  "phone" text,
  "position" integer DEFAULT 1,
  "status" text DEFAULT 'queued'::text,
  "reason" text,
  "digits" text,
  "twilio_call_sid" text,
  "dry_run" boolean DEFAULT false,
  "slot_date" date,
  "slot_start" time without time zone,
  "minutes" integer,
  "km" numeric,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.lead_change_requests (
  "id" uuid DEFAULT gen_random_uuid(),
  "lead_id" uuid,
  "requested_by" uuid,
  "request_type" text,
  "current_value" text,
  "requested_value" text,
  "reason" text,
  "status" text DEFAULT 'pending'::text,
  "reviewed_by" uuid,
  "reviewed_at" timestamp with time zone,
  "review_notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "source" text DEFAULT 'agent'::text,
  "customer_message" text
);
CREATE TABLE public.lead_routing_log (
  "id" uuid DEFAULT gen_random_uuid(),
  "lead_id" uuid,
  "from_company" uuid,
  "to_company" uuid,
  "area_id" uuid,
  "km" numeric,
  "mode" text,
  "reason" text,
  "decided_by" uuid,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.leads (
  "id" uuid DEFAULT gen_random_uuid(),
  "customer_name" text,
  "customer_phone" text,
  "customer_address" text,
  "latitude" numeric(10,8),
  "longitude" numeric(11,8),
  "service_type" text,
  "status" text DEFAULT 'pending'::text,
  "notes" text,
  "assigned_agent_id" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "accepted_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "priority" text DEFAULT 'normal'::text,
  "started_at" timestamp with time zone,
  "customer_id" uuid,
  "equipment_id" uuid,
  "broadcast_radius_km" numeric,
  "agreement_id" uuid,
  "scheduled_date" date,
  "estimated_duration_minutes" integer,
  "estimated_end_time" timestamp with time zone,
  "actual_start_time" timestamp with time zone,
  "scheduled_time" time without time zone,
  "unit_id" uuid,
  "assignment_method" text DEFAULT 'manual'::text,
  "assignment_score" double precision,
  "offer_count" integer DEFAULT 0,
  "company_id" uuid,
  "converted_at" timestamp with time zone,
  "order_status" text,
  "parts_status" text,
  "technician_name" text,
  "technician_eta" timestamp with time zone,
  "source" lead_source DEFAULT 'manual'::lead_source,
  "external_id" text,
  "idempotency_key" text,
  "raw_payload" jsonb,
  "phone" text,
  "email" text,
  "normalized_address" text,
  "company_name" text,
  "merged_into_id" uuid,
  "merge_history" jsonb DEFAULT '[]'::jsonb,
  "interaction_history" jsonb DEFAULT '[]'::jsonb,
  "intents" text[],
  "primary_intent" lead_intent,
  "confidence" numeric,
  "classified_by" lead_classifier,
  "lead_priority" lead_priority_level DEFAULT 'standard'::lead_priority_level,
  "lead_score" integer,
  "cancellation_reason" text,
  "sla_breached_at" timestamp with time zone,
  "lead_status" lead_lifecycle_status DEFAULT 'new'::lead_lifecycle_status,
  "last_activity_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone,
  "location" text,
  "needs_manual_assignment" boolean DEFAULT false,
  "created_by" uuid,
  "first_contact_at" timestamp with time zone,
  "first_contact_channel" text,
  "contact_attempts" integer DEFAULT 0,
  "last_contact_attempt_at" timestamp with time zone,
  "last_contact_outcome" text,
  "stage2_done_at" timestamp with time zone,
  "quote_sla_breached_at" timestamp with time zone,
  "call_summary" text,
  "call_area" text,
  "call_urgency" text,
  "call_next_action" text,
  "call_summary_model" text,
  "call_summary_at" timestamp with time zone,
  "dup_ok" boolean DEFAULT false,
  "second_visit_of" uuid,
  "acknowledged_at" timestamp with time zone,
  "acknowledged_by" uuid,
  "visit_booked_at" timestamp with time zone,
  "dismissed_at" timestamp with time zone,
  "dismissed_by" uuid,
  "dismiss_reason" text,
  "closed_at" timestamp with time zone,
  "closed_by" uuid,
  "close_outcome" text,
  "close_reason" text,
  "close_note" text,
  "pre_close_status" text,
  "pre_close_lead_status" lead_lifecycle_status,
  "marketing_followup" boolean DEFAULT false
);
CREATE TABLE public.maintenance_schedules (
  "id" uuid DEFAULT gen_random_uuid(),
  "agreement_id" uuid,
  "customer_id" uuid,
  "equipment_id" uuid,
  "lead_id" uuid,
  "due_date" date,
  "status" text DEFAULT 'upcoming'::text,
  "reminder_7d_sent" boolean DEFAULT false,
  "reminder_2d_sent" boolean DEFAULT false,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.mandy_undo_snapshots (
  "id" uuid DEFAULT gen_random_uuid(),
  "quote_id" uuid,
  "user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "action" text,
  "label" text,
  "snapshot" jsonb,
  "quote_updated_at_after" timestamp with time zone,
  "state_hash_after" text,
  "used_at" timestamp with time zone
);
CREATE TABLE public.mandy_voice_logs (
  "id" uuid DEFAULT gen_random_uuid(),
  "user_id" uuid,
  "company_id" uuid,
  "channel" text DEFAULT 'quote_mode'::text,
  "quote_id" uuid,
  "transcript" text,
  "plan" jsonb,
  "matches" jsonb,
  "status" text DEFAULT 'planned'::text,
  "result" jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.notification_queue (
  "id" uuid DEFAULT gen_random_uuid(),
  "customer_id" uuid,
  "lead_id" uuid,
  "invoice_id" uuid,
  "notification_type" text,
  "channel" text DEFAULT 'email'::text,
  "recipient_email" text,
  "recipient_phone" text,
  "subject" text,
  "body" text,
  "variables" jsonb DEFAULT '{}'::jsonb,
  "status" text DEFAULT 'pending'::text,
  "scheduled_at" timestamp with time zone DEFAULT now(),
  "sent_at" timestamp with time zone,
  "attempts" integer DEFAULT 0,
  "max_attempts" integer DEFAULT 3,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.notifications (
  "id" uuid DEFAULT gen_random_uuid(),
  "user_id" uuid,
  "type" text,
  "title" text,
  "body" text,
  "read" boolean DEFAULT false,
  "related_id" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "metadata" jsonb DEFAULT '{}'::jsonb
);
CREATE TABLE public.offers (
  "id" uuid DEFAULT gen_random_uuid(),
  "lead_id" uuid,
  "staff_id" uuid,
  "company_id" uuid,
  "offer_type" text DEFAULT 'sales_estimate'::text,
  "sequence" integer DEFAULT 1,
  "status" text DEFAULT 'pending'::text,
  "distance_km" numeric,
  "expires_at" timestamp with time zone,
  "responded_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "job_id" uuid,
  "respond_by" timestamp with time zone
);
CREATE TABLE public.payment_followups (
  "id" uuid DEFAULT gen_random_uuid(),
  "company_id" uuid,
  "invoice_id" uuid,
  "customer_id" uuid,
  "customer_name" text,
  "customer_phone" text,
  "invoice_number" text,
  "amount_due" numeric(12,2) DEFAULT 0,
  "due_date" date,
  "days_late" integer,
  "stage" integer DEFAULT 0,
  "status" text DEFAULT 'pending'::text,
  "channel" text DEFAULT 'email'::text,
  "proposed_message" text,
  "approved_message" text,
  "requested_by" uuid,
  "decided_by" uuid,
  "decided_at" timestamp with time zone,
  "decision_note" text,
  "sent_by" uuid,
  "sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "step" text,
  "subject" text
);
CREATE TABLE public.payments (
  "id" uuid DEFAULT gen_random_uuid(),
  "invoice_id" uuid,
  "amount" numeric(12,2),
  "payment_date" date,
  "method" text,
  "reference" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "company_id" uuid,
  "gateway" text DEFAULT 'manual'::text,
  "gateway_reference" text,
  "checkout_id" text,
  "status" text DEFAULT 'pending'::text,
  "environment" text DEFAULT 'sandbox'::text,
  "currency" text DEFAULT 'ZAR'::text,
  "raw_payload" jsonb,
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.profiles (
  "id" uuid,
  "full_name" text,
  "phone" text,
  "avatar_url" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "home_base_lat" numeric,
  "home_base_lng" numeric,
  "location_tracking_enabled" boolean DEFAULT false,
  "availability_status" text DEFAULT 'available'::text,
  "last_availability_update" timestamp with time zone DEFAULT now(),
  "onboarding_completed" boolean DEFAULT false,
  "subscription_status" text DEFAULT 'trial'::text,
  "subscription_plan" text DEFAULT 'free'::text,
  "trial_ends_at" timestamp with time zone,
  "stripe_customer_id" text,
  "jobs_limit" integer DEFAULT 50,
  "company_id" uuid,
  "workshop_address" text,
  "workshop_lat" double precision,
  "workshop_lng" double precision,
  "home_lat" double precision,
  "home_lng" double precision,
  "home_radius_m" integer DEFAULT 500,
  "max_travel_km" double precision DEFAULT 50,
  "skills" text[],
  "whatsapp_notifications" boolean DEFAULT false,
  "participant_type" text DEFAULT 'company_staff'::text,
  "network_status" text,
  "dispatch_role" text,
  "dispatch_active" boolean DEFAULT true,
  "home_location" text,
  "search_aliases" text[],
  "welcome_tour_dismissed" boolean DEFAULT false,
  "welcome_tour_auto_count" integer DEFAULT 0,
  "archived_at" timestamp with time zone,
  "office_address" text,
  "office_lat" double precision,
  "office_lng" double precision,
  "start_from" text,
  "job_title" text,
  "signature_phone" text,
  "signature_email" text,
  "signature_enabled" boolean DEFAULT true,
  "lead_contact_pref" text DEFAULT 'app'::text,
  "signup_role" text,
  "signup_company" text
);
CREATE TABLE public.proposal_sections (
  "id" uuid DEFAULT gen_random_uuid(),
  "quote_id" uuid,
  "section_type" text,
  "title" text,
  "content" text,
  "sort_order" integer DEFAULT 0,
  "photos" jsonb DEFAULT '[]'::jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.proposals (
  "id" uuid DEFAULT gen_random_uuid(),
  "customer_id" uuid,
  "lead_id" uuid,
  "quote_id" uuid,
  "proposal_number" text DEFAULT ''::text,
  "reference" text,
  "issue_date" date,
  "due_date" date,
  "subtotal" numeric DEFAULT 0,
  "discount_type" text DEFAULT 'percent'::text,
  "discount_value" numeric DEFAULT 0,
  "discount_amount" numeric DEFAULT 0,
  "tax_rate" numeric DEFAULT 15,
  "tax_amount" numeric DEFAULT 0,
  "total" numeric DEFAULT 0,
  "notes" text,
  "terms" text,
  "status" text DEFAULT 'draft'::text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "company_id" uuid,
  "areas" jsonb DEFAULT '[]'::jsonb,
  "source" text DEFAULT 'web'::text,
  "total_amount" numeric DEFAULT 0
);
CREATE TABLE public.purchase_order_documents (
  "id" uuid DEFAULT gen_random_uuid(),
  "company_id" uuid,
  "po_id" uuid,
  "supplier_id" uuid,
  "job_id" uuid,
  "customer_id" uuid,
  "doc_type" text,
  "storage_path" text,
  "file_name" text,
  "internal_only" boolean DEFAULT true,
  "uploaded_by" uuid,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.purchase_orders (
  "id" uuid DEFAULT gen_random_uuid(),
  "company_id" uuid,
  "supplier_id" uuid,
  "po_number" text,
  "seq" integer,
  "status" text DEFAULT 'draft'::text,
  "invoice_id" uuid,
  "job_id" uuid,
  "customer_id" uuid,
  "client_name" text,
  "job_reference" text,
  "supplier_account_number" text,
  "supplier_emails" text[],
  "deliver_to" text,
  "notes" text,
  "subtotal" numeric DEFAULT 0,
  "vat_amount" numeric DEFAULT 0,
  "total" numeric DEFAULT 0,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.quote_areas (
  "id" uuid DEFAULT gen_random_uuid(),
  "quote_id" uuid,
  "name" text,
  "sort_order" integer DEFAULT 0,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "description" text
);
CREATE TABLE public.quote_attachments (
  "id" uuid DEFAULT gen_random_uuid(),
  "quote_id" uuid,
  "storage_path" text,
  "filename" text,
  "caption" text,
  "annotation" jsonb,
  "taken_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.quote_brochures (
  "id" uuid DEFAULT gen_random_uuid(),
  "quote_id" uuid,
  "brochure_id" uuid,
  "sort_order" integer DEFAULT 0,
  "is_auto_matched" boolean DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.quote_bundles (
  "id" uuid DEFAULT gen_random_uuid(),
  "token" uuid DEFAULT gen_random_uuid(),
  "company_id" uuid,
  "customer_id" uuid,
  "quote_ids" uuid[],
  "created_by" uuid,
  "sent_to" text,
  "sent_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.quote_change_requests (
  "id" uuid DEFAULT gen_random_uuid(),
  "quote_id" uuid,
  "company_id" uuid,
  "message" text,
  "contact_name" text,
  "contact_phone" text,
  "status" text DEFAULT 'open'::text,
  "created_at" timestamp with time zone DEFAULT now(),
  "resolved_at" timestamp with time zone,
  "resolved_by" uuid
);
CREATE TABLE public.quote_client_revisions (
  "id" uuid DEFAULT gen_random_uuid(),
  "quote_id" uuid,
  "company_id" uuid,
  "status" text DEFAULT 'pending'::text,
  "lines" jsonb,
  "subtotal" numeric,
  "discount_amount" numeric DEFAULT 0,
  "vat_amount" numeric,
  "total" numeric,
  "original_total" numeric,
  "client_note" text,
  "contact_name" text,
  "original_items" jsonb,
  "original_totals" jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "decided_at" timestamp with time zone,
  "decided_by" uuid,
  "decision_note" text
);
CREATE TABLE public.quote_documents (
  "id" uuid DEFAULT gen_random_uuid(),
  "quote_id" uuid,
  "company_id" uuid,
  "storage_path" text,
  "filename" text,
  "size_bytes" integer,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.quote_email_sends (
  "id" uuid DEFAULT gen_random_uuid(),
  "send_id" uuid,
  "quote_id" uuid,
  "company_id" uuid,
  "kind" text DEFAULT 'quote'::text,
  "recipient" text,
  "cc" text[],
  "status" text DEFAULT 'sending'::text,
  "error" text,
  "attempts" integer DEFAULT 1,
  "retry_of" uuid,
  "resend_id" text,
  "created_by" uuid,
  "started_at" timestamp with time zone DEFAULT now(),
  "finished_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.quote_followups (
  "id" uuid DEFAULT gen_random_uuid(),
  "quote_id" uuid,
  "company_id" uuid,
  "seq" integer,
  "result" text,
  "next_at" timestamp with time zone,
  "note" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.quote_items (
  "id" uuid DEFAULT gen_random_uuid(),
  "quote_id" uuid,
  "item_name" text,
  "item_number" text,
  "description" text,
  "unit_price" numeric DEFAULT 0,
  "quantity" numeric DEFAULT 1,
  "notes" text,
  "source" text DEFAULT 'catalog'::text,
  "supplier" text,
  "product_id" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "area_id" uuid,
  "parent_item_id" uuid,
  "is_bundle" boolean DEFAULT false,
  "length" numeric,
  "total_price" numeric,
  "item_type" text,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "sort_order" integer DEFAULT 0,
  "unit_type" pricing_unit_type DEFAULT 'each'::pricing_unit_type,
  "price_per_unit_qty" numeric DEFAULT 1,
  "price_per_unit_label" text DEFAULT 'each'::text,
  "allows_decimal_qty" boolean DEFAULT false,
  "qty_step" numeric DEFAULT 1,
  "min_qty" numeric DEFAULT 1
);
CREATE TABLE public.quote_line_items (
  "id" uuid DEFAULT gen_random_uuid(),
  "quote_id" uuid,
  "service_id" uuid,
  "description" text,
  "quantity" integer,
  "unit_price" numeric(10,2),
  "total" numeric(12,2),
  "created_at" timestamp with time zone DEFAULT now(),
  "quote_version_id" uuid,
  "unit" text,
  "sort_order" integer DEFAULT 0
);
CREATE TABLE public.quote_lock_events (
  "id" uuid DEFAULT gen_random_uuid(),
  "quote_id" uuid,
  "company_id" uuid,
  "action" text,
  "reason" text,
  "actor" uuid,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.quote_versions (
  "id" uuid DEFAULT gen_random_uuid(),
  "quote_id" uuid,
  "version_number" integer,
  "total_ex_vat" numeric(12,2) DEFAULT 0,
  "total_incl_vat" numeric(12,2) DEFAULT 0,
  "notes" text,
  "terms" text,
  "valid_until" date,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.quotes (
  "id" uuid DEFAULT gen_random_uuid(),
  "customer_id" uuid,
  "lead_id" uuid,
  "sales_engineer_id" uuid,
  "status" text DEFAULT 'draft'::text,
  "quote_number" text,
  "subtotal" numeric(12,2) DEFAULT 0,
  "vat_rate" numeric(5,4) DEFAULT 0.15,
  "vat_amount" numeric(12,2) DEFAULT 0,
  "total" numeric(12,2) DEFAULT 0,
  "notes" text,
  "valid_until" date,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "sent_at" timestamp with time zone,
  "viewed_at" timestamp with time zone,
  "accepted_at" timestamp with time zone,
  "declined_at" timestamp with time zone,
  "accepted_by" text,
  "public_token" uuid DEFAULT gen_random_uuid(),
  "accepted_signature" jsonb,
  "visual_sections" jsonb DEFAULT '[]'::jsonb,
  "terms_text" text,
  "discount_type" text DEFAULT 'none'::text,
  "discount_value" numeric DEFAULT 0,
  "reference_text" text,
  "customer_name" text,
  "company_id" uuid,
  "location_id" uuid,
  "legacy_original_total" numeric,
  "superseded_by" uuid,
  "site_id" uuid,
  "current_version_id" uuid,
  "accepted_version_id" uuid,
  "owner_id" uuid,
  "created_by" uuid,
  "units_markup_percent" numeric,
  "materials_markup_percent" numeric,
  "labour_mode" text DEFAULT 'per_area'::text,
  "materials_waste_percent" numeric,
  "payment_plan" jsonb,
  "show_unit_cards" boolean DEFAULT true,
  "labour_included" boolean DEFAULT false,
  "sent_method" text,
  "sent_channel" text,
  "sent_note" text,
  "sent_by" uuid,
  "client_summary" text,
  "remote_quote" boolean DEFAULT false,
  "remote_quote_source" text,
  "parent_quote_id" uuid,
  "is_variation" boolean DEFAULT false,
  "variation_job_id" uuid,
  "locked_at" timestamp with time zone,
  "locked_by" uuid,
  "locked_reason" text,
  "variation_summary" jsonb,
  "followup_kind" text,
  "followup_state" text,
  "followup_count" integer DEFAULT 0,
  "followup_next_at" timestamp with time zone
);
CREATE TABLE public.sales_commission_snapshots (
  "id" uuid DEFAULT gen_random_uuid(),
  "quote_id" uuid,
  "quote_number" text,
  "company_id" uuid,
  "rep_id" uuid,
  "percent" numeric,
  "items_sell_ex_vat" numeric,
  "items_cost" numeric,
  "items_profit" numeric,
  "commission" numeric,
  "unknown_cost_count" integer DEFAULT 0,
  "rule" jsonb,
  "status" text DEFAULT 'earned'::text,
  "earned_at" timestamp with time zone DEFAULT now(),
  "invoice_paid_date" date,
  "paid_at" date,
  "paid_by" uuid,
  "paid_marked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.shop_orders (
  "id" uuid DEFAULT gen_random_uuid(),
  "company_id" uuid,
  "order_ref" text,
  "status" text DEFAULT 'pending'::text,
  "environment" text,
  "contact" jsonb,
  "preferred" jsonb,
  "notes" text,
  "rooms" jsonb,
  "lines" jsonb,
  "subtotal_ex" numeric(12,2),
  "vat_amount" numeric(12,2),
  "total_incl" numeric(12,2),
  "terms_version" text,
  "terms_accepted_at" timestamp with time zone,
  "yoco_checkout_id" text,
  "yoco_payment_id" text,
  "ip_hash" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "expires_at" timestamp with time zone,
  "paid_at" timestamp with time zone,
  "finalized_at" timestamp with time zone,
  "customer_id" uuid,
  "lead_id" uuid,
  "quote_id" uuid,
  "invoice_id" uuid,
  "job_id" uuid,
  "payment_id" uuid,
  "email_sent_at" timestamp with time zone,
  "last_event" jsonb,
  "error" text
);
CREATE TABLE public.site_surveys (
  "id" uuid DEFAULT gen_random_uuid(),
  "company_id" uuid,
  "lead_id" uuid,
  "quote_id" uuid,
  "created_by" uuid,
  "status" text DEFAULT 'draft'::text,
  "report_no" text,
  "access_note" text,
  "access_flags" jsonb DEFAULT '{}'::jsonb,
  "lat" double precision,
  "lng" double precision,
  "address_confirmed_at" timestamp with time zone,
  "started_at" timestamp with time zone DEFAULT now(),
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "archived_at" timestamp with time zone
);
CREATE TABLE public.supplier_bills (
  "id" uuid DEFAULT gen_random_uuid(),
  "company_id" uuid,
  "supplier_id" uuid,
  "supplier_name" text,
  "po_id" uuid,
  "job_id" uuid,
  "bill_number" text,
  "bill_date" date,
  "due_date" date,
  "amount_excl" numeric(12,2) DEFAULT 0,
  "vat_amount" numeric(12,2) DEFAULT 0,
  "amount_incl" numeric(12,2) DEFAULT 0,
  "amount_paid" numeric(12,2) DEFAULT 0,
  "status" text DEFAULT 'unpaid'::text,
  "notes" text,
  "document_path" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.tech_earnings_ledger (
  "id" uuid DEFAULT gen_random_uuid(),
  "company_id" uuid,
  "job_id" uuid,
  "quote_id" uuid,
  "quote_number" text,
  "tech_id" uuid,
  "bucket" text,
  "percent" numeric,
  "labour_base" numeric,
  "amount" numeric,
  "reduction_amount" numeric DEFAULT 0,
  "status" text,
  "completed_at" timestamp with time zone,
  "release_after" date,
  "callback_job_id" uuid,
  "rule" jsonb,
  "paid_at" date,
  "note" text,
  "status_changed_at" timestamp with time zone,
  "status_changed_by" uuid,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.unassigned_queue (
  "id" uuid DEFAULT gen_random_uuid(),
  "lead_id" uuid,
  "company_id" uuid,
  "reason" text,
  "priority" text DEFAULT 'standard'::text,
  "escalate_at" timestamp with time zone,
  "escalated" boolean DEFAULT false,
  "escalated_at" timestamp with time zone,
  "resolved" boolean DEFAULT false,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.user_roles (
  "id" uuid DEFAULT gen_random_uuid(),
  "user_id" uuid,
  "role" app_role,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE public.vapi_calls (
  "id" uuid DEFAULT gen_random_uuid(),
  "company_id" uuid,
  "provider" text DEFAULT 'vapi'::text,
  "provider_call_id" text,
  "direction" text DEFAULT 'inbound'::text,
  "caller_phone" text,
  "caller_name" text,
  "business_phone" text,
  "customer_id" uuid,
  "lead_id" uuid,
  "started_at" timestamp with time zone,
  "ended_at" timestamp with time zone,
  "duration_seconds" integer DEFAULT 0,
  "ended_reason" text,
  "service_type" text,
  "urgency" text,
  "summary" text,
  "transcript" text,
  "recording_url" text,
  "outcome" text,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  "call_category" text,
  "is_existing_client" boolean DEFAULT false,
  "quote_id" uuid,
  "error_reason" text
);
CREATE TABLE public.whatsapp_conversation_state (
  "id" uuid DEFAULT gen_random_uuid(),
  "phone" text,
  "state" text,
  "customer_id" uuid,
  "lead_id" uuid,
  "job_id" uuid,
  "context" jsonb DEFAULT '{}'::jsonb,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
ALTER TABLE public.whatsapp_conversation_state ADD CONSTRAINT whatsapp_conversation_state_pkey PRIMARY KEY (id);
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);
ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE public.leads ADD CONSTRAINT leads_pkey PRIMARY KEY (id);
ALTER TABLE public.invoices ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);
ALTER TABLE public.invoices ADD CONSTRAINT invoices_invoice_number_key UNIQUE (invoice_number);
ALTER TABLE public.customers ADD CONSTRAINT customers_pkey PRIMARY KEY (id);
ALTER TABLE public.customer_feedback ADD CONSTRAINT customer_feedback_pkey PRIMARY KEY (id);
ALTER TABLE public.quote_line_items ADD CONSTRAINT quote_line_items_pkey PRIMARY KEY (id);
ALTER TABLE public.quote_attachments ADD CONSTRAINT quote_attachments_pkey PRIMARY KEY (id);
ALTER TABLE public.notification_queue ADD CONSTRAINT notification_queue_pkey PRIMARY KEY (id);
ALTER TABLE public.job_photos ADD CONSTRAINT job_photos_pkey PRIMARY KEY (id);
ALTER TABLE public.lead_change_requests ADD CONSTRAINT lead_change_requests_pkey PRIMARY KEY (id);
ALTER TABLE public.invoice_items ADD CONSTRAINT invoice_items_pkey PRIMARY KEY (id);
ALTER TABLE public.quotes ADD CONSTRAINT quotes_pkey PRIMARY KEY (id);
ALTER TABLE public.quotes ADD CONSTRAINT quotes_quote_number_key UNIQUE (quote_number);
ALTER TABLE public.payments ADD CONSTRAINT payments_pkey PRIMARY KEY (id);
ALTER TABLE public.job_expenses ADD CONSTRAINT job_expenses_pkey PRIMARY KEY (id);
ALTER TABLE public.proposal_sections ADD CONSTRAINT proposal_sections_pkey PRIMARY KEY (id);
ALTER TABLE public.job_time_entries ADD CONSTRAINT job_time_entries_pkey PRIMARY KEY (id);
ALTER TABLE public.notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
ALTER TABLE public.communication_log ADD CONSTRAINT communication_log_pkey PRIMARY KEY (id);
ALTER TABLE public.job_schedules ADD CONSTRAINT job_schedules_pkey PRIMARY KEY (id);
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);
ALTER TABLE public.quote_documents ADD CONSTRAINT quote_documents_pkey PRIMARY KEY (id);
ALTER TABLE public.quote_documents ADD CONSTRAINT quote_documents_storage_path_key UNIQUE (storage_path);
ALTER TABLE public.job_used_parts ADD CONSTRAINT job_used_parts_pkey PRIMARY KEY (id);
ALTER TABLE public.jobs ADD CONSTRAINT jobs_pkey PRIMARY KEY (id);
ALTER TABLE public.maintenance_schedules ADD CONSTRAINT maintenance_schedules_pkey PRIMARY KEY (id);
ALTER TABLE public.quote_items ADD CONSTRAINT quote_items_pkey PRIMARY KEY (id);
ALTER TABLE public.proposals ADD CONSTRAINT proposals_pkey PRIMARY KEY (id);
ALTER TABLE public.companies ADD CONSTRAINT companies_pkey PRIMARY KEY (id);
ALTER TABLE public.company_members ADD CONSTRAINT company_members_pkey PRIMARY KEY (id);
ALTER TABLE public.company_members ADD CONSTRAINT company_members_user_id_company_id_key UNIQUE (user_id, company_id);
ALTER TABLE public.assignments ADD CONSTRAINT assignments_pkey PRIMARY KEY (id);
ALTER TABLE public.companies ADD CONSTRAINT companies_slug_key UNIQUE (slug);
ALTER TABLE public.company_invoices ADD CONSTRAINT company_invoices_pkey PRIMARY KEY (id);
ALTER TABLE public.quote_areas ADD CONSTRAINT quote_areas_pkey PRIMARY KEY (id);
ALTER TABLE public.mandy_voice_logs ADD CONSTRAINT mandy_voice_logs_pkey PRIMARY KEY (id);
ALTER TABLE public.quote_brochures ADD CONSTRAINT quote_brochures_pkey PRIMARY KEY (id);
ALTER TABLE public.quote_brochures ADD CONSTRAINT quote_brochures_quote_id_brochure_id_key UNIQUE (quote_id, brochure_id);
ALTER TABLE public.job_activity_log ADD CONSTRAINT job_activity_log_pkey PRIMARY KEY (id);
ALTER TABLE public.quote_versions ADD CONSTRAINT quote_versions_pkey PRIMARY KEY (id);
ALTER TABLE public.quote_versions ADD CONSTRAINT quote_versions_quote_id_version_number_key UNIQUE (quote_id, version_number);
ALTER TABLE public.offers ADD CONSTRAINT offers_pkey PRIMARY KEY (id);
ALTER TABLE public.unassigned_queue ADD CONSTRAINT unassigned_queue_pkey PRIMARY KEY (id);
ALTER TABLE public.change_orders ADD CONSTRAINT change_orders_pkey PRIMARY KEY (id);
ALTER TABLE public.vapi_calls ADD CONSTRAINT vapi_calls_pkey PRIMARY KEY (id);
ALTER TABLE public.change_order_line_items ADD CONSTRAINT change_order_line_items_pkey PRIMARY KEY (id);
ALTER TABLE public.job_completions ADD CONSTRAINT job_completions_pkey PRIMARY KEY (id);
ALTER TABLE public.credit_notes ADD CONSTRAINT credit_notes_pkey PRIMARY KEY (id);
ALTER TABLE public.credit_notes ADD CONSTRAINT credit_notes_credit_note_number_key UNIQUE (credit_note_number);
ALTER TABLE public.mandy_undo_snapshots ADD CONSTRAINT mandy_undo_snapshots_pkey PRIMARY KEY (id);
ALTER TABLE public.job_overruns ADD CONSTRAINT job_overruns_pkey PRIMARY KEY (id);
ALTER TABLE public.job_site_checks ADD CONSTRAINT job_site_checks_pkey PRIMARY KEY (id);
ALTER TABLE public.job_variations ADD CONSTRAINT job_variations_pkey PRIMARY KEY (id);
ALTER TABLE public.quote_lock_events ADD CONSTRAINT quote_lock_events_pkey PRIMARY KEY (id);
ALTER TABLE public.sales_commission_snapshots ADD CONSTRAINT sales_commission_snapshots_pkey PRIMARY KEY (id);
ALTER TABLE public.sales_commission_snapshots ADD CONSTRAINT sales_commission_snapshots_quote_id_key UNIQUE (quote_id);
ALTER TABLE public.tech_earnings_ledger ADD CONSTRAINT tech_earnings_ledger_pkey PRIMARY KEY (id);
ALTER TABLE public.tech_earnings_ledger ADD CONSTRAINT tech_earnings_ledger_job_id_tech_id_bucket_key UNIQUE (job_id, tech_id, bucket);
ALTER TABLE public.lead_routing_log ADD CONSTRAINT lead_routing_log_pkey PRIMARY KEY (id);
ALTER TABLE public.expenses ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);
ALTER TABLE public.invoice_requests ADD CONSTRAINT invoice_requests_pkey PRIMARY KEY (id);
ALTER TABLE public.quote_bundles ADD CONSTRAINT quote_bundles_pkey PRIMARY KEY (id);
ALTER TABLE public.quote_bundles ADD CONSTRAINT quote_bundles_token_key UNIQUE (token);
ALTER TABLE public.lead_call_attempts ADD CONSTRAINT lead_call_attempts_pkey PRIMARY KEY (id);
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_pkey PRIMARY KEY (id);
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_company_id_po_number_key UNIQUE (company_id, po_number);
ALTER TABLE public.purchase_order_documents ADD CONSTRAINT purchase_order_documents_pkey PRIMARY KEY (id);
ALTER TABLE public.quote_change_requests ADD CONSTRAINT quote_change_requests_pkey PRIMARY KEY (id);
ALTER TABLE public.quote_client_revisions ADD CONSTRAINT quote_client_revisions_pkey PRIMARY KEY (id);
ALTER TABLE public.supplier_bills ADD CONSTRAINT supplier_bills_pkey PRIMARY KEY (id);
ALTER TABLE public.payment_followups ADD CONSTRAINT payment_followups_pkey PRIMARY KEY (id);
ALTER TABLE public.job_alerts ADD CONSTRAINT job_alerts_pkey PRIMARY KEY (id);
ALTER TABLE public.job_alerts ADD CONSTRAINT job_alerts_job_id_rule_key UNIQUE (job_id, rule);
ALTER TABLE public.quote_email_sends ADD CONSTRAINT quote_email_sends_pkey PRIMARY KEY (id);
ALTER TABLE public.quote_email_sends ADD CONSTRAINT quote_email_sends_send_id_key UNIQUE (send_id);
ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_pkey PRIMARY KEY (id);
ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_order_ref_key UNIQUE (order_ref);
ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_yoco_checkout_id_key UNIQUE (yoco_checkout_id);
ALTER TABLE public.site_surveys ADD CONSTRAINT site_surveys_pkey PRIMARY KEY (id);
ALTER TABLE public.site_surveys ADD CONSTRAINT site_surveys_report_no_key UNIQUE (report_no);
ALTER TABLE public.cf_receipts ADD CONSTRAINT cf_receipts_pkey PRIMARY KEY (id);
ALTER TABLE public.cf_receipts ADD CONSTRAINT cf_receipts_company_id_source_key_key UNIQUE (company_id, source_key);
ALTER TABLE public.cf_commitments ADD CONSTRAINT cf_commitments_pkey PRIMARY KEY (id);
ALTER TABLE public.cf_commitments ADD CONSTRAINT cf_commitments_company_id_source_key_key UNIQUE (company_id, source_key);
ALTER TABLE public.cf_stock_allocations ADD CONSTRAINT cf_stock_allocations_pkey PRIMARY KEY (id);
ALTER TABLE public.quote_followups ADD CONSTRAINT quote_followups_pkey PRIMARY KEY (id);
ALTER TABLE public.invoice_send_approvals ADD CONSTRAINT invoice_send_approvals_pkey PRIMARY KEY (id);
ALTER TABLE public.invoice_send_approvals ADD CONSTRAINT invoice_send_approvals_invoice_id_key UNIQUE (invoice_id);
ALTER TABLE public.invoice_send_events ADD CONSTRAINT invoice_send_events_pkey PRIMARY KEY (id);
ALTER TABLE public.quotes ADD CONSTRAINT quotes_parent_quote_id_fkey FOREIGN KEY (parent_quote_id) REFERENCES quotes(id) ON DELETE SET NULL;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
ALTER TABLE public.leads ADD CONSTRAINT leads_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id);
ALTER TABLE public.customer_feedback ADD CONSTRAINT customer_feedback_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;
ALTER TABLE public.customer_feedback ADD CONSTRAINT customer_feedback_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE public.quotes ADD CONSTRAINT quotes_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE public.quote_line_items ADD CONSTRAINT quote_line_items_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE;
ALTER TABLE public.quote_attachments ADD CONSTRAINT quote_attachments_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE;
ALTER TABLE public.notification_queue ADD CONSTRAINT notification_queue_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;
ALTER TABLE public.notification_queue ADD CONSTRAINT notification_queue_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE public.notification_queue ADD CONSTRAINT notification_queue_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;
ALTER TABLE public.quotes ADD CONSTRAINT quotes_variation_job_id_fkey FOREIGN KEY (variation_job_id) REFERENCES jobs(id) ON DELETE SET NULL;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_variation_quote_id_fkey FOREIGN KEY (variation_quote_id) REFERENCES quotes(id) ON DELETE SET NULL;
ALTER TABLE public.lead_change_requests ADD CONSTRAINT lead_change_requests_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quotes(id);
ALTER TABLE public.maintenance_schedules ADD CONSTRAINT maintenance_schedules_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id);
ALTER TABLE public.invoices ADD CONSTRAINT invoices_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id);
ALTER TABLE public.invoice_items ADD CONSTRAINT invoice_items_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;
ALTER TABLE public.quotes ADD CONSTRAINT quotes_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id);
ALTER TABLE public.jobs ADD CONSTRAINT jobs_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE public.payments ADD CONSTRAINT payments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;
ALTER TABLE public.quotes ADD CONSTRAINT quotes_superseded_by_fkey FOREIGN KEY (superseded_by) REFERENCES quotes(id) ON DELETE SET NULL;
ALTER TABLE public.proposal_sections ADD CONSTRAINT proposal_sections_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE;
ALTER TABLE public.job_time_entries ADD CONSTRAINT job_time_entries_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
ALTER TABLE public.communication_log ADD CONSTRAINT communication_log_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
ALTER TABLE public.communication_log ADD CONSTRAINT communication_log_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;
ALTER TABLE public.job_schedules ADD CONSTRAINT job_schedules_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
ALTER TABLE public.quote_documents ADD CONSTRAINT quote_documents_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE;
ALTER TABLE public.job_used_parts ADD CONSTRAINT job_used_parts_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE public.whatsapp_conversation_state ADD CONSTRAINT whatsapp_conversation_state_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id);
ALTER TABLE public.whatsapp_conversation_state ADD CONSTRAINT whatsapp_conversation_state_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quotes(id);
ALTER TABLE public.jobs ADD CONSTRAINT jobs_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id);
ALTER TABLE public.quote_items ADD CONSTRAINT quote_items_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE;
ALTER TABLE public.proposals ADD CONSTRAINT proposals_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id);
ALTER TABLE public.proposals ADD CONSTRAINT proposals_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id);
ALTER TABLE public.proposals ADD CONSTRAINT proposals_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quotes(id);
ALTER TABLE public.company_members ADD CONSTRAINT company_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.company_members ADD CONSTRAINT company_members_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE public.company_invoices ADD CONSTRAINT company_invoices_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE public.company_invoices ADD CONSTRAINT company_invoices_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id);
ALTER TABLE public.company_invoices ADD CONSTRAINT company_invoices_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quotes(id);
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE public.proposals ADD CONSTRAINT proposals_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE public.quote_areas ADD CONSTRAINT quote_areas_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE;
ALTER TABLE public.quote_items ADD CONSTRAINT quote_items_parent_item_id_fkey FOREIGN KEY (parent_item_id) REFERENCES quote_items(id) ON DELETE CASCADE;
ALTER TABLE public.assignments ADD CONSTRAINT assignments_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
ALTER TABLE public.assignments ADD CONSTRAINT assignments_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id);
ALTER TABLE public.assignments ADD CONSTRAINT assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES profiles(id);
ALTER TABLE public.job_expenses ADD CONSTRAINT job_expenses_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE public.maintenance_schedules ADD CONSTRAINT maintenance_schedules_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE public.quote_brochures ADD CONSTRAINT quote_brochures_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE;
ALTER TABLE public.job_activity_log ADD CONSTRAINT job_activity_log_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
ALTER TABLE public.leads ADD CONSTRAINT leads_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE public.quotes ADD CONSTRAINT quotes_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE public.invoices ADD CONSTRAINT invoices_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE public.customers ADD CONSTRAINT customers_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE public.job_activity_log ADD CONSTRAINT job_activity_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id);
ALTER TABLE public.quote_versions ADD CONSTRAINT quote_versions_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE;
ALTER TABLE public.quotes ADD CONSTRAINT quotes_current_version_id_fkey FOREIGN KEY (current_version_id) REFERENCES quote_versions(id) ON DELETE SET NULL;
ALTER TABLE public.quotes ADD CONSTRAINT quotes_accepted_version_id_fkey FOREIGN KEY (accepted_version_id) REFERENCES quote_versions(id) ON DELETE SET NULL;
ALTER TABLE public.offers ADD CONSTRAINT offers_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
ALTER TABLE public.offers ADD CONSTRAINT offers_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.quote_line_items ADD CONSTRAINT quote_line_items_quote_version_id_fkey FOREIGN KEY (quote_version_id) REFERENCES quote_versions(id) ON DELETE CASCADE;
ALTER TABLE public.unassigned_queue ADD CONSTRAINT unassigned_queue_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
ALTER TABLE public.change_orders ADD CONSTRAINT change_orders_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE;
ALTER TABLE public.vapi_calls ADD CONSTRAINT vapi_calls_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE public.vapi_calls ADD CONSTRAINT vapi_calls_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE public.vapi_calls ADD CONSTRAINT vapi_calls_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE public.offers ADD CONSTRAINT offers_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
ALTER TABLE public.change_orders ADD CONSTRAINT change_orders_accepted_quote_version_id_fkey FOREIGN KEY (accepted_quote_version_id) REFERENCES quote_versions(id) ON DELETE RESTRICT;
ALTER TABLE public.change_orders ADD CONSTRAINT change_orders_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL;
ALTER TABLE public.change_order_line_items ADD CONSTRAINT change_order_line_items_change_order_id_fkey FOREIGN KEY (change_order_id) REFERENCES change_orders(id) ON DELETE CASCADE;
ALTER TABLE public.change_order_line_items ADD CONSTRAINT change_order_line_items_original_line_item_id_fkey FOREIGN KEY (original_line_item_id) REFERENCES quote_line_items(id) ON DELETE SET NULL;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;
ALTER TABLE public.job_overruns ADD CONSTRAINT job_overruns_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
ALTER TABLE public.vapi_calls ADD CONSTRAINT vapi_calls_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE SET NULL;
ALTER TABLE public.leads ADD CONSTRAINT leads_merged_into_id_fkey FOREIGN KEY (merged_into_id) REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE public.job_completions ADD CONSTRAINT job_completions_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE public.job_completions ADD CONSTRAINT job_completions_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL;
ALTER TABLE public.customers ADD CONSTRAINT customers_assigned_rep_id_fkey FOREIGN KEY (assigned_rep_id) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.credit_notes ADD CONSTRAINT credit_notes_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE public.credit_notes ADD CONSTRAINT credit_notes_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id);
ALTER TABLE public.job_schedules ADD CONSTRAINT job_schedules_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
ALTER TABLE public.mandy_undo_snapshots ADD CONSTRAINT mandy_undo_snapshots_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE;
ALTER TABLE public.job_overruns ADD CONSTRAINT job_overruns_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
ALTER TABLE public.job_overruns ADD CONSTRAINT job_overruns_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE SET NULL;
ALTER TABLE public.job_site_checks ADD CONSTRAINT job_site_checks_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
ALTER TABLE public.job_site_checks ADD CONSTRAINT job_site_checks_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE SET NULL;
ALTER TABLE public.job_site_checks ADD CONSTRAINT job_site_checks_variation_quote_id_fkey FOREIGN KEY (variation_quote_id) REFERENCES quotes(id) ON DELETE SET NULL;
ALTER TABLE public.quote_items ADD CONSTRAINT quote_items_area_id_fkey FOREIGN KEY (area_id) REFERENCES quote_areas(id) ON DELETE CASCADE;
ALTER TABLE public.job_variations ADD CONSTRAINT job_variations_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
ALTER TABLE public.job_variations ADD CONSTRAINT job_variations_original_quote_id_fkey FOREIGN KEY (original_quote_id) REFERENCES quotes(id) ON DELETE SET NULL;
ALTER TABLE public.job_variations ADD CONSTRAINT job_variations_variation_quote_id_fkey FOREIGN KEY (variation_quote_id) REFERENCES quotes(id) ON DELETE SET NULL;
ALTER TABLE public.job_variations ADD CONSTRAINT job_variations_site_check_id_fkey FOREIGN KEY (site_check_id) REFERENCES job_site_checks(id) ON DELETE SET NULL;
ALTER TABLE public.quote_lock_events ADD CONSTRAINT quote_lock_events_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE;
ALTER TABLE public.leads ADD CONSTRAINT leads_second_visit_of_fkey FOREIGN KEY (second_visit_of) REFERENCES leads(id) ON DELETE SET NULL;
ALTER TABLE public.purchase_order_documents ADD CONSTRAINT purchase_order_documents_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL;
ALTER TABLE public.lead_routing_log ADD CONSTRAINT lead_routing_log_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id);
ALTER TABLE public.invoice_requests ADD CONSTRAINT invoice_requests_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_duplicated_from_fkey FOREIGN KEY (duplicated_from) REFERENCES invoices(id) ON DELETE SET NULL;
ALTER TABLE public.purchase_order_documents ADD CONSTRAINT purchase_order_documents_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE public.lead_call_attempts ADD CONSTRAINT lead_call_attempts_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL;
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL;
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE public.purchase_order_documents ADD CONSTRAINT purchase_order_documents_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE public.purchase_order_documents ADD CONSTRAINT purchase_order_documents_po_id_fkey FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE CASCADE;
ALTER TABLE public.quote_change_requests ADD CONSTRAINT quote_change_requests_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE;
ALTER TABLE public.quote_client_revisions ADD CONSTRAINT quote_client_revisions_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE;
ALTER TABLE public.supplier_bills ADD CONSTRAINT supplier_bills_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE public.supplier_bills ADD CONSTRAINT supplier_bills_po_id_fkey FOREIGN KEY (po_id) REFERENCES purchase_orders(id) ON DELETE SET NULL;
ALTER TABLE public.supplier_bills ADD CONSTRAINT supplier_bills_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL;
ALTER TABLE public.payment_followups ADD CONSTRAINT payment_followups_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE public.payment_followups ADD CONSTRAINT payment_followups_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;
ALTER TABLE public.job_alerts ADD CONSTRAINT job_alerts_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE;
ALTER TABLE public.quote_email_sends ADD CONSTRAINT quote_email_sends_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE;
ALTER TABLE public.quote_email_sends ADD CONSTRAINT quote_email_sends_retry_of_fkey FOREIGN KEY (retry_of) REFERENCES quote_email_sends(id) ON DELETE SET NULL;
ALTER TABLE public.shop_orders ADD CONSTRAINT shop_orders_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE public.site_surveys ADD CONSTRAINT site_surveys_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;
ALTER TABLE public.site_surveys ADD CONSTRAINT site_surveys_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE SET NULL;
ALTER TABLE public.site_surveys ADD CONSTRAINT site_surveys_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id);
ALTER TABLE public.cf_receipts ADD CONSTRAINT cf_receipts_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE public.cf_receipts ADD CONSTRAINT cf_receipts_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;
ALTER TABLE public.cf_receipts ADD CONSTRAINT cf_receipts_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE;
ALTER TABLE public.cf_commitments ADD CONSTRAINT cf_commitments_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE public.cf_commitments ADD CONSTRAINT cf_commitments_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;
ALTER TABLE public.cf_commitments ADD CONSTRAINT cf_commitments_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE;
ALTER TABLE public.cf_commitments ADD CONSTRAINT cf_commitments_job_id_fkey FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL;
ALTER TABLE public.cf_stock_allocations ADD CONSTRAINT cf_stock_allocations_company_id_fkey FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;
ALTER TABLE public.cf_stock_allocations ADD CONSTRAINT cf_stock_allocations_commitment_id_fkey FOREIGN KEY (commitment_id) REFERENCES cf_commitments(id) ON DELETE CASCADE;
ALTER TABLE public.quote_followups ADD CONSTRAINT quote_followups_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE;
ALTER TABLE public.invoice_send_approvals ADD CONSTRAINT invoice_send_approvals_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;
ALTER TABLE public.invoice_send_events ADD CONSTRAINT invoice_send_events_approval_id_fkey FOREIGN KEY (approval_id) REFERENCES invoice_send_approvals(id) ON DELETE CASCADE;
