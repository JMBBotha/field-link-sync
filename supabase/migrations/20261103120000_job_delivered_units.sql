-- Delivered indoor/outdoor codes + serials per job, captured when a supplier document line is received
-- against a job. Read by the invoice editor to suggest "Delivered: Indoor X / Outdoor Y" under the unit line.
-- Additive only. NOT APPLIED until approved. Rollback: 20261103120000_job_delivered_units_ROLLBACK.sql
ALTER TABLE public.supplier_job_document_lines ADD COLUMN IF NOT EXISTS serial_no text;

CREATE TABLE IF NOT EXISTS public.job_delivered_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  document_line_id uuid NOT NULL UNIQUE REFERENCES public.supplier_job_document_lines(id) ON DELETE CASCADE,
  product_id uuid,
  half text CHECK (half IN ('indoor','outdoor')),
  supplier_code text NOT NULL,
  serial_no text,
  qty numeric NOT NULL DEFAULT 1,
  doc_number text,
  delivered_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_delivered_units_job ON public.job_delivered_units (job_id);
ALTER TABLE public.job_delivered_units ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jdu_office_all ON public.job_delivered_units;
CREATE POLICY jdu_office_all ON public.job_delivered_units FOR ALL TO authenticated
  USING (public.sjd_ok(company_id)) WITH CHECK (public.sjd_ok(company_id));

CREATE OR REPLACE FUNCTION public.jdu_capture() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_job uuid := coalesce(NEW.receive_job_id, NEW.job_id); v_half text; v_doc text;
BEGIN
  IF NEW.received_at IS NULL OR v_job IS NULL OR coalesce(NEW.model_number,'') = '' THEN RETURN NEW; END IF;
  SELECT a.half INTO v_half FROM public.supplier_product_code_aliases a
   WHERE a.company_id = NEW.company_id AND a.active
     AND upper(regexp_replace(a.supplier_code,'[\s_/.-]+','','g')) = upper(regexp_replace(NEW.model_number,'[\s_/.-]+','','g')) LIMIT 1;
  IF v_half IS NULL AND upper(NEW.model_number) ~ '^A[RJC].*[0-9A-Z][NX]$' THEN
    v_half := CASE WHEN upper(NEW.model_number) ~ 'X$' THEN 'outdoor' ELSE 'indoor' END;   -- Samsung N = indoor, X = outdoor
  END IF;
  SELECT doc_number INTO v_doc FROM public.supplier_job_documents WHERE id = NEW.document_id;
  INSERT INTO public.job_delivered_units (company_id, job_id, document_line_id, product_id, half, supplier_code, serial_no, qty, doc_number)
  VALUES (NEW.company_id, v_job, NEW.id, NEW.product_id, v_half, upper(NEW.model_number), NEW.serial_no, coalesce(NEW.qty,1), v_doc)
  ON CONFLICT (document_line_id) DO UPDATE SET job_id = EXCLUDED.job_id, serial_no = EXCLUDED.serial_no, product_id = EXCLUDED.product_id, half = EXCLUDED.half;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_jdu_capture ON public.supplier_job_document_lines;
CREATE TRIGGER trg_jdu_capture AFTER UPDATE OF received_at, serial_no, receive_job_id ON public.supplier_job_document_lines
  FOR EACH ROW EXECUTE FUNCTION public.jdu_capture();
