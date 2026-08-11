CREATE OR REPLACE FUNCTION public.notify_new_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.notifications (user_id, type, title, body, related_id)
  SELECT ur.user_id,
         'new_lead',
         'New Lead',
         COALESCE(NEW.customer_name, 'New lead') ||
           COALESCE(' - ' || NEW.service_type, '') ||
           COALESCE(' (' || NEW.source::text || ')', ''),
         NEW.id
  FROM public.user_roles ur
  JOIN public.profiles p ON p.id = ur.user_id
  WHERE ur.role IN ('admin', 'dispatcher')
    AND (NEW.company_id IS NULL OR p.company_id = NEW.company_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_notify_new_lead ON public.leads;
CREATE TRIGGER tr_notify_new_lead
AFTER INSERT ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.notify_new_lead();