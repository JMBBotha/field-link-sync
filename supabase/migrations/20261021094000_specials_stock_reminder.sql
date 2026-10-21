-- Johan 09:38: specials "while stocks last" + units left, and a 7-day end reminder in the in-app bell.
-- Rollback: docs/db-releases/2026-10-21_specials_stock_reminder_rollback.sql
ALTER TABLE public.supplier_specials
  ADD COLUMN IF NOT EXISTS while_stocks_last boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS units_left integer CHECK (units_left IS NULL OR units_left >= 0),
  ADD COLUMN IF NOT EXISTS ending_reminder_for date;

-- Extending (new end date) re-arms the reminder.
CREATE OR REPLACE FUNCTION public.supplier_specials_rearm_reminder() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.end_date IS DISTINCT FROM OLD.end_date THEN NEW.ending_reminder_for := NULL; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS supplier_specials_rearm_reminder ON public.supplier_specials;
CREATE TRIGGER supplier_specials_rearm_reminder BEFORE UPDATE ON public.supplier_specials
  FOR EACH ROW EXECUTE FUNCTION public.supplier_specials_rearm_reminder();

-- 7 days before end_date: bell for the master company's admins (Massair CT). No email/WhatsApp.
CREATE OR REPLACE FUNCTION public.notify_specials_ending() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN
    SELECT s.id, s.model_number, s.end_date FROM public.supplier_specials s
    WHERE s.is_active AND s.start_date <= current_date
      AND s.end_date BETWEEN current_date AND current_date + 7
      AND coalesce(s.units_left, 1) > 0
      AND s.ending_reminder_for IS DISTINCT FROM s.end_date
  LOOP
    INSERT INTO public.notifications (user_id, type, title, body, read, related_id, metadata)
    SELECT p.id, 'special_ending', 'Special ends ' || to_char(r.end_date, 'DD Mon'),
      r.model_number || ' special ends ' || to_char(r.end_date, 'DD Mon') || '. Tap to extend it (change the end date) or let it end.',
      false, r.id, jsonb_build_object('special_id', r.id, 'end_date', r.end_date, 'model_number', r.model_number)
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role = 'admin'::app_role
    JOIN public.companies c ON c.id = p.company_id AND c.is_master;
    UPDATE public.supplier_specials SET ending_reminder_for = r.end_date WHERE id = r.id;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.notify_specials_ending() FROM PUBLIC, anon, authenticated;

DO $$ BEGIN
  PERFORM cron.unschedule('specials-ending-reminder') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'specials-ending-reminder');
  PERFORM cron.schedule('specials-ending-reminder', '0 5 * * *', 'SELECT public.notify_specials_ending()');
END $$;

-- The 4 Fourways Comfee Black Friday specials: while stocks last.
UPDATE public.supplier_specials SET while_stocks_last = true
WHERE supplier_id = '64dad53f-73f5-4cbb-9c39-6b298aeb8c41' AND model_number IN ('FCMI-09','FCMI-12','FCMI-18','FCMI-24') AND end_date = '2026-10-31';
