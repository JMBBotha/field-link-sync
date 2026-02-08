
-- ============================================================
-- PHASE 3: Time Tracking + Bug Fixes
-- ============================================================

-- BUG FIX #1: The existing trigger already prevents duplicates via
-- IF OLD.status IS DISTINCT FROM 'accepted' AND NEW.status = 'accepted'
-- plus IF EXISTS (SELECT 1 FROM invoices WHERE quote_id = NEW.id) THEN RETURN NEW;
-- No change needed.

-- BUG FIX #2: Create trigger to auto-recalculate quote totals on line item changes
CREATE OR REPLACE FUNCTION public.recalculate_quote_totals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote_id uuid;
  v_subtotal numeric;
  v_vat_rate numeric;
BEGIN
  -- Determine which quote_id to recalculate
  IF TG_OP = 'DELETE' THEN
    v_quote_id := OLD.quote_id;
  ELSE
    v_quote_id := NEW.quote_id;
  END IF;

  -- Calculate subtotal from line items
  SELECT COALESCE(SUM(quantity * unit_price), 0)
  INTO v_subtotal
  FROM public.quote_line_items
  WHERE quote_id = v_quote_id;

  -- Get vat_rate from quote
  SELECT vat_rate INTO v_vat_rate
  FROM public.quotes
  WHERE id = v_quote_id;

  -- Update quote totals
  UPDATE public.quotes
  SET subtotal = v_subtotal,
      vat_amount = v_subtotal * COALESCE(v_vat_rate, 0.15),
      total = v_subtotal + (v_subtotal * COALESCE(v_vat_rate, 0.15)),
      updated_at = now()
  WHERE id = v_quote_id;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_recalculate_quote_totals
AFTER INSERT OR UPDATE OR DELETE ON public.quote_line_items
FOR EACH ROW
EXECUTE FUNCTION public.recalculate_quote_totals();

-- ============================================================
-- TIME TRACKING
-- ============================================================

CREATE TABLE public.job_time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL,
  work_date date NOT NULL DEFAULT CURRENT_DATE,
  start_time time NOT NULL,
  end_time time NOT NULL,
  hours_onsite numeric(5,2) GENERATED ALWAYS AS (
    EXTRACT(EPOCH FROM (end_time - start_time)) / 3600.0
  ) STORED,
  travel_hours numeric(5,2) NOT NULL DEFAULT 0,
  is_billable boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.job_time_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Agents can view own time entries"
ON public.job_time_entries FOR SELECT
USING (agent_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Agents can create own time entries"
ON public.job_time_entries FOR INSERT
WITH CHECK (agent_id = auth.uid());

CREATE POLICY "Agents can update own time entries"
ON public.job_time_entries FOR UPDATE
USING (agent_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete time entries"
ON public.job_time_entries FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));

-- RPC: Get total billable hours for a job
CREATE OR REPLACE FUNCTION public.get_job_billable_hours(p_lead_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(hours_onsite + travel_hours), 0)
  FROM public.job_time_entries
  WHERE lead_id = p_lead_id AND is_billable = true;
$$;

-- RPC: Convert time entries to invoice line items
CREATE OR REPLACE FUNCTION public.convert_time_to_invoice_items(
  p_lead_id uuid,
  p_invoice_id uuid,
  p_hourly_rate numeric DEFAULT 450
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
  v_entry record;
BEGIN
  FOR v_entry IN
    SELECT work_date, SUM(hours_onsite) as total_hours, SUM(travel_hours) as total_travel
    FROM public.job_time_entries
    WHERE lead_id = p_lead_id AND is_billable = true
    GROUP BY work_date
    ORDER BY work_date
  LOOP
    -- Insert onsite hours
    IF v_entry.total_hours > 0 THEN
      INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, amount)
      VALUES (
        p_invoice_id,
        'Labour - ' || to_char(v_entry.work_date, 'DD Mon YYYY'),
        1,
        ROUND(v_entry.total_hours * p_hourly_rate, 2),
        ROUND(v_entry.total_hours * p_hourly_rate, 2)
      );
      v_count := v_count + 1;
    END IF;

    -- Insert travel hours
    IF v_entry.total_travel > 0 THEN
      INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, amount)
      VALUES (
        p_invoice_id,
        'Travel - ' || to_char(v_entry.work_date, 'DD Mon YYYY'),
        1,
        ROUND(v_entry.total_travel * p_hourly_rate, 2),
        ROUND(v_entry.total_travel * p_hourly_rate, 2)
      );
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$$;

-- Enable realtime for time entries
ALTER PUBLICATION supabase_realtime ADD TABLE public.job_time_entries;
