-- Rollback for 20261028160000_quote_options_move_back. Puts option_not_chosen quotes back to viewed/sent first.
BEGIN;
SELECT set_config('app.quote_lock_bypass','on',true);
DROP TRIGGER IF EXISTS trg_quote_stage_log ON public.quotes;
UPDATE public.quotes SET status = CASE WHEN viewed_at IS NOT NULL THEN 'viewed' WHEN sent_at IS NOT NULL THEN 'sent' ELSE 'draft' END WHERE status = 'option_not_chosen';
ALTER TABLE public.quotes DROP CONSTRAINT IF EXISTS quotes_status_check;
ALTER TABLE public.quotes ADD CONSTRAINT quotes_status_check CHECK (status = ANY (ARRAY['draft','sent','viewed','accepted','declined']));
DROP FUNCTION IF EXISTS public.quote_move_back(uuid, text);
DROP FUNCTION IF EXISTS public.link_quote_options(uuid[], jsonb);
DROP FUNCTION IF EXISTS public.unlink_quote_option(uuid);
DROP FUNCTION IF EXISTS public.fl_can_manage_quotes(uuid, uuid);
DROP FUNCTION IF EXISTS public.fl_quote_stage_log();
CREATE OR REPLACE FUNCTION public.notify_quote_status_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF NEW.status = 'accepted'
       AND position(',' || NEW.id::text || ',' IN COALESCE(current_setting('app.isa_alerted_quotes', true), '')) > 0 THEN
      RETURN NEW;
    END IF;
    INSERT INTO public.notifications (user_id, type, title, body, related_id)
    VALUES (NEW.sales_engineer_id, 'quote_status_change', 'Quote ' || INITCAP(NEW.status),
            'Quote ' || NEW.quote_number || ' has been ' || NEW.status, NEW.id);
  END IF;
  RETURN NEW;
END $$;
DROP TABLE IF EXISTS public.quote_stage_events;
ALTER TABLE public.quotes DROP COLUMN IF EXISTS option_chosen_id, DROP COLUMN IF EXISTS option_label, DROP COLUMN IF EXISTS option_group_id;
COMMIT;
