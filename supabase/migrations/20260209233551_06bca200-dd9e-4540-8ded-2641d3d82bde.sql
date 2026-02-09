
-- Create the update_updated_at_column function if it doesn't exist
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create maintenance_schedules table
CREATE TABLE public.maintenance_schedules (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agreement_id UUID NOT NULL REFERENCES public.service_agreements(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id),
  equipment_id UUID REFERENCES public.equipment(id),
  lead_id UUID REFERENCES public.leads(id),
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'scheduled', 'completed', 'overdue', 'skipped')),
  reminder_7d_sent BOOLEAN NOT NULL DEFAULT false,
  reminder_2d_sent BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.maintenance_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage maintenance_schedules"
ON public.maintenance_schedules FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Field agents can view their maintenance schedules"
ON public.maintenance_schedules FOR SELECT
USING (
  has_role(auth.uid(), 'field_agent'::app_role)
  AND EXISTS (
    SELECT 1 FROM leads WHERE leads.id = maintenance_schedules.lead_id AND leads.assigned_agent_id = auth.uid()
  )
);

CREATE INDEX idx_maintenance_schedules_due_date ON public.maintenance_schedules(due_date);
CREATE INDEX idx_maintenance_schedules_status ON public.maintenance_schedules(status);
CREATE INDEX idx_maintenance_schedules_agreement ON public.maintenance_schedules(agreement_id);

CREATE TRIGGER update_maintenance_schedules_updated_at
BEFORE UPDATE ON public.maintenance_schedules
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.maintenance_schedules;

-- Function to get overdue maintenance count
CREATE OR REPLACE FUNCTION public.get_overdue_maintenance_count()
RETURNS INTEGER AS $$
  SELECT count(*)::integer FROM public.maintenance_schedules
  WHERE status = 'overdue' OR (status = 'upcoming' AND due_date < CURRENT_DATE);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Function to bulk generate maintenance schedules from active agreements
CREATE OR REPLACE FUNCTION public.generate_maintenance_schedules(months_ahead INTEGER DEFAULT 6)
RETURNS INTEGER AS $$
DECLARE
  agreement RECORD;
  next_due DATE;
  interval_months INTEGER;
  schedules_created INTEGER := 0;
BEGIN
  FOR agreement IN
    SELECT sa.id as agreement_id, sa.customer_id, sa.equipment_id, sa.frequency,
           COALESCE(sa.next_service_due, sa.start_date) as next_service_due,
           sa.end_date
    FROM service_agreements sa
    WHERE sa.status = 'active' AND sa.auto_generate_jobs = true
  LOOP
    interval_months := CASE agreement.frequency
      WHEN 'monthly' THEN 1
      WHEN 'quarterly' THEN 3
      WHEN 'biannual' THEN 6
      WHEN 'annual' THEN 12
      ELSE 12
    END;

    next_due := agreement.next_service_due;

    WHILE next_due <= CURRENT_DATE + (months_ahead || ' months')::interval
      AND next_due <= agreement.end_date
    LOOP
      IF NOT EXISTS (
        SELECT 1 FROM maintenance_schedules
        WHERE maintenance_schedules.agreement_id = agreement.agreement_id
          AND maintenance_schedules.due_date = next_due
      ) THEN
        INSERT INTO maintenance_schedules (agreement_id, customer_id, equipment_id, due_date)
        VALUES (agreement.agreement_id, agreement.customer_id, agreement.equipment_id, next_due);
        schedules_created := schedules_created + 1;
      END IF;

      next_due := next_due + (interval_months || ' months')::interval;
    END LOOP;
  END LOOP;

  RETURN schedules_created;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function to mark overdue schedules
CREATE OR REPLACE FUNCTION public.mark_overdue_maintenance()
RETURNS INTEGER AS $$
DECLARE
  cnt INTEGER;
BEGIN
  UPDATE maintenance_schedules
  SET status = 'overdue', updated_at = now()
  WHERE status = 'upcoming' AND due_date < CURRENT_DATE;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  RETURN cnt;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
