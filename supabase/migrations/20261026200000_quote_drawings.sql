-- Quote Drawings (HVAC Design layouts on quotes). Johan 26 Oct 2026 19:36 "Go with A plus B".
-- UNAPPLIED until Johan's go. Rollback: /workspace/quote-drawings-2026-10-26/rollback.sql
-- Access: own company only; admins + the quote's own rep. No field techs, no dispatchers.
-- BOQ rows are internal: never listed to clients, never appended to the client PDF.

-- 1. Access helper: admin of the quote's company, or the quote's rep. Techs never.
CREATE OR REPLACE FUNCTION public.drawing_quote_ok(_quote uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL
    AND NOT public.is_field_tech_only(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.quotes q
      WHERE q.id = _quote AND q.company_id = public.caller_company_id()
        AND (
          (public.has_role(auth.uid(), 'admin'::app_role) AND NOT public.is_sales_rep(auth.uid()))
          OR public.is_company_admin(auth.uid(), q.company_id)
          OR auth.uid() IN (q.sales_engineer_id, q.owner_id, q.created_by)
        ));
$$;

CREATE OR REPLACE FUNCTION public.drawing_admin_ok(_company uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT auth.uid() IS NOT NULL AND _company = public.caller_company_id()
    AND NOT public.is_field_tech_only(auth.uid()) AND NOT public.is_sales_rep(auth.uid())
    AND (public.has_role(auth.uid(), 'admin'::app_role) OR public.is_company_admin(auth.uid(), _company));
$$;

-- 2. Table
CREATE TABLE IF NOT EXISTS public.quote_drawings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  company_id uuid NOT NULL,
  storage_path text NOT NULL UNIQUE,          -- {company_id}/{quote_id}/{uuid}.{ext}  (no client names)
  filename text NOT NULL,                     -- e.g. Q-2026-0047_G1_mechanical_RevD.pdf
  kind text NOT NULL CHECK (kind IN ('pdf','png','boq_csv')),
  area text,
  revision text,
  size_bytes integer CHECK (size_bytes IS NULL OR size_bytes <= 10485760),
  include_in_client_pdf boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quote_drawings_path_company CHECK (split_part(storage_path,'/',1) = company_id::text
                                              AND split_part(storage_path,'/',2) = quote_id::text),
  CONSTRAINT quote_drawings_boq_internal CHECK (kind <> 'boq_csv' OR include_in_client_pdf = false)
);
CREATE INDEX IF NOT EXISTS quote_drawings_quote_idx ON public.quote_drawings (quote_id, sort_order);

-- BOQ is forced internal even if a client sends include=true.
CREATE OR REPLACE FUNCTION public.quote_drawings_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.kind = 'boq_csv' THEN NEW.include_in_client_pdf := false; END IF;
  NEW.updated_at := now();
  IF TG_OP = 'UPDATE' THEN  -- only the include tick / order may change
    NEW.quote_id := OLD.quote_id; NEW.company_id := OLD.company_id; NEW.storage_path := OLD.storage_path;
    NEW.kind := OLD.kind; NEW.created_by := OLD.created_by; NEW.created_at := OLD.created_at;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS quote_drawings_guard_t ON public.quote_drawings;
CREATE TRIGGER quote_drawings_guard_t BEFORE INSERT OR UPDATE ON public.quote_drawings
  FOR EACH ROW EXECUTE FUNCTION public.quote_drawings_guard();

ALTER TABLE public.quote_drawings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.quote_drawings FROM anon;
CREATE POLICY qdr_select ON public.quote_drawings FOR SELECT TO authenticated
  USING (company_id = public.caller_company_id() AND public.drawing_quote_ok(quote_id));
CREATE POLICY qdr_insert ON public.quote_drawings FOR INSERT TO authenticated
  WITH CHECK (company_id = public.caller_company_id() AND public.drawing_quote_ok(quote_id)
              AND EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_id AND q.company_id = public.caller_company_id()));
CREATE POLICY qdr_update ON public.quote_drawings FOR UPDATE TO authenticated
  USING (company_id = public.caller_company_id() AND public.drawing_quote_ok(quote_id))
  WITH CHECK (company_id = public.caller_company_id() AND public.drawing_quote_ok(quote_id));
CREATE POLICY qdr_delete ON public.quote_drawings FOR DELETE TO authenticated
  USING (public.drawing_admin_ok(company_id));

-- 3. Private bucket (created in SQL, no edge function needed). 10 MB cap, pdf/png/csv only.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('quote-drawings','quote-drawings', false, 10485760, ARRAY['application/pdf','image/png','text/csv','application/vnd.ms-excel'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage path must be {caller company}/{quote uuid}/... and the caller must pass drawing_quote_ok.
CREATE OR REPLACE FUNCTION public.quote_drawing_path_ok(_name text, _admin_only boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH f AS (SELECT storage.foldername(_name) AS p)
  SELECT auth.uid() IS NOT NULL AND public.caller_company_id() IS NOT NULL
    AND (SELECT p[1] FROM f) = public.caller_company_id()::text
    AND (SELECT p[2] FROM f) ~* '^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$'
    AND CASE WHEN _admin_only THEN public.drawing_admin_ok(public.caller_company_id())
             ELSE public.drawing_quote_ok((SELECT p[2] FROM f)::uuid) END;
$$;
CREATE POLICY qdraw_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'quote-drawings' AND public.quote_drawing_path_ok(name, false));
CREATE POLICY qdraw_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'quote-drawings' AND public.quote_drawing_path_ok(name, false));
CREATE POLICY qdraw_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'quote-drawings' AND (public.quote_drawing_path_ok(name, true)
         -- the uploader may remove an orphan file if the DB insert failed (no row yet)
         OR (public.quote_drawing_path_ok(name, false) AND NOT EXISTS (SELECT 1 FROM public.quote_drawings d WHERE d.storage_path = name))));

-- 4. Client quote link: list included, non-BOQ drawings by token (ids + filenames only).
CREATE OR REPLACE FUNCTION public.public_quote_drawings(p_token uuid)
RETURNS TABLE (id uuid, filename text, kind text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT d.id, d.filename, d.kind FROM public.quote_drawings d JOIN public.quotes q ON q.id = d.quote_id
  WHERE q.public_token = p_token AND d.include_in_client_pdf AND d.kind IN ('pdf','png')
  ORDER BY d.sort_order, d.created_at;
$$;
REVOKE ALL ON FUNCTION public.public_quote_drawings(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.public_quote_drawings(uuid) TO anon, authenticated;

-- 5. Storage cleanup when a quote (cascade) or drawing row is deleted: queue the path.
--    Storage objects cannot be removed from SQL safely; the app removes the file on delete,
--    and this queue catches cascade deletes for a later sweep (process-outbox or manual).
CREATE TABLE IF NOT EXISTS public.quote_drawings_deleted_files (
  storage_path text PRIMARY KEY, company_id uuid, deleted_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.quote_drawings_deleted_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY qddf_admin ON public.quote_drawings_deleted_files FOR ALL TO authenticated
  USING (public.drawing_admin_ok(company_id)) WITH CHECK (public.drawing_admin_ok(company_id));
CREATE OR REPLACE FUNCTION public.quote_drawings_queue_delete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO public.quote_drawings_deleted_files (storage_path, company_id) VALUES (OLD.storage_path, OLD.company_id)
  ON CONFLICT DO NOTHING; RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS quote_drawings_queue_delete_t ON public.quote_drawings;
CREATE TRIGGER quote_drawings_queue_delete_t AFTER DELETE ON public.quote_drawings
  FOR EACH ROW EXECUTE FUNCTION public.quote_drawings_queue_delete();
