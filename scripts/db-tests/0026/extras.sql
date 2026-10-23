-- 0026 extras on top of the 0025 stub: jobs, fmt_rand_sql (live copy), and the live quote triggers
CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), quote_id uuid, job_type text);
CREATE OR REPLACE FUNCTION public.fmt_rand_sql(v numeric) RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT 'R ' || translate(to_char(COALESCE(v,0),'FM999,999,999,990.00'), ',.', ' ,') $$;
CREATE OR REPLACE FUNCTION public.create_invoice_from_accepted_quote()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
BEGIN
  IF NEW.is_variation THEN RETURN NEW; END IF;
  IF OLD.status IS DISTINCT FROM 'accepted' AND NEW.status = 'accepted' THEN
    PERFORM public.create_deposit_invoice_for_quote(NEW.id);
  END IF;
  RETURN NEW;
END; $function$;
CREATE OR REPLACE FUNCTION public.p3_notify_quote_accepted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF lower(COALESCE(NEW.status, '')) = 'accepted' AND lower(COALESCE(OLD.status, '')) <> 'accepted'
     AND NEW.sales_engineer_id IS NOT NULL AND NOT NEW.is_variation /*r2*/
     AND NOT EXISTS (SELECT 1 FROM public.jobs WHERE quote_id = NEW.id AND job_type = 'installation') THEN
    INSERT INTO public.notifications (user_id, type, title, body, related_id, metadata)
    VALUES (NEW.sales_engineer_id, 'quote_accepted_handover',
            'Quote ' || COALESCE(NEW.quote_number, '') || ' accepted — hand to technician',
            COALESCE(NEW.customer_name, 'Client') || ' accepted. Open the visit to hand it over.', NEW.id,
            jsonb_build_object('quote_id', NEW.id, 'lead_id', NEW.lead_id,
              'link', CASE WHEN NEW.lead_id IS NOT NULL THEN '/admin/visits/' || NEW.lead_id::text ELSE '/admin/estimates/' || NEW.id::text END));
  END IF;
  RETURN NEW;
END $function$;
;
CREATE OR REPLACE FUNCTION public.notify_quote_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.notifications (user_id, type, title, body, related_id)
    VALUES (
      NEW.sales_engineer_id,
      'quote_status_change',
      'Quote ' || INITCAP(NEW.status),
      'Quote ' || NEW.quote_number || ' has been ' || NEW.status,
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$function$;
;
CREATE TRIGGER on_quote_accepted AFTER UPDATE ON public.quotes FOR EACH ROW EXECUTE FUNCTION public.create_invoice_from_accepted_quote();
CREATE TRIGGER p3_quote_accepted_handover AFTER UPDATE ON public.quotes FOR EACH ROW EXECUTE FUNCTION public.p3_notify_quote_accepted();
CREATE TRIGGER tr_notify_quote_status AFTER UPDATE ON public.quotes FOR EACH ROW WHEN (old.status IS DISTINCT FROM new.status) EXECUTE FUNCTION public.notify_quote_status_change();
