CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.trigger_auto_assign_lead()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.latitude IS NOT NULL AND NEW.latitude != 0 
     AND NEW.longitude IS NOT NULL AND NEW.longitude != 0 
     AND NEW.status IN ('pending', 'new')
     AND NEW.assigned_agent_id IS NULL THEN
    
    PERFORM net.http_post(
      url := 'https://rvzapfbifggovccebrjp.supabase.co/functions/v1/auto-assign-lead',
      body := jsonb_build_object('lead_id', NEW.id),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-api-key', 'becool-webhook-2026-secure'
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_lead_insert_auto_assign ON leads;
CREATE TRIGGER on_lead_insert_auto_assign
  AFTER INSERT ON leads
  FOR EACH ROW
  EXECUTE FUNCTION trigger_auto_assign_lead();