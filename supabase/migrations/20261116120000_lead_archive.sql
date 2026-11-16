-- Lead archive for Open leads on admin Home.
-- NOT APPLIED by the preview that added this file. Run it (and only it) when the
-- archive button for a lead that has no quote should start working.
-- Quotes already archive through quote_archive / quotes.archived_at. This does not
-- change invoices, payments, jobs, or quote rows.
-- Rollback: supabase/manual/20261116120000_lead_archive_rollback.sql

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS archived_by uuid;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS archive_reason text;
CREATE INDEX IF NOT EXISTS idx_leads_company_not_archived
  ON public.leads (company_id, created_at DESC)
  WHERE archived_at IS NULL;

COMMENT ON COLUMN public.leads.archived_at IS
  'Set by lead_archive. The lead leaves Open leads. Status, invoices, and payments stay. lead_unarchive clears it.';

-- Same people who may close a lead: company admin, or a sales rep for their own or an unassigned lead.
CREATE OR REPLACE FUNCTION public.lead_archive(p_lead uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE l public.leads;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(coalesce(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Give a reason for archiving this lead';
  END IF;
  IF NOT public.can_close_lead(p_lead) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO l FROM public.leads WHERE id = p_lead FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead not found' USING ERRCODE = 'P0002';
  END IF;
  IF l.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Lead is already archived';
  END IF;
  INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, user_id, company_id)
  VALUES ('leads', l.id, 'update',
          jsonb_build_object('archived_at', l.archived_at, 'status', l.status),
          jsonb_build_object('event', 'archive', 'reason', btrim(p_reason)),
          auth.uid(), l.company_id);
  UPDATE public.leads
     SET archived_at = now(), archived_by = auth.uid(), archive_reason = btrim(p_reason)
   WHERE id = l.id;
  RETURN jsonb_build_object('archived', true, 'lead_id', l.id);
END $$;

CREATE OR REPLACE FUNCTION public.lead_unarchive(p_lead uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE l public.leads;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in' USING ERRCODE = '42501';
  END IF;
  IF NOT public.can_close_lead(p_lead) THEN
    RAISE EXCEPTION 'Not allowed' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO l FROM public.leads WHERE id = p_lead FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead not found' USING ERRCODE = 'P0002';
  END IF;
  IF l.archived_at IS NULL THEN
    RAISE EXCEPTION 'Lead is not archived';
  END IF;
  UPDATE public.leads
     SET archived_at = NULL, archived_by = NULL, archive_reason = NULL
   WHERE id = l.id;
  INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, user_id, company_id)
  VALUES ('leads', l.id, 'update',
          jsonb_build_object('archived_at', l.archived_at, 'archived_by', l.archived_by, 'archive_reason', l.archive_reason),
          jsonb_build_object('event', 'unarchive'),
          auth.uid(), l.company_id);
  RETURN jsonb_build_object('archived', false, 'lead_id', l.id);
END $$;

REVOKE ALL ON FUNCTION public.lead_archive(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lead_unarchive(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lead_archive(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lead_unarchive(uuid) TO authenticated;
