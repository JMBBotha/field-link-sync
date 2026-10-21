-- Rollback for supabase/migrations/20261021094000_specials_stock_reminder.sql
SELECT cron.unschedule('specials-ending-reminder') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'specials-ending-reminder');
DELETE FROM public.notifications WHERE type = 'special_ending';
DROP FUNCTION IF EXISTS public.notify_specials_ending();
DROP TRIGGER IF EXISTS supplier_specials_rearm_reminder ON public.supplier_specials;
DROP FUNCTION IF EXISTS public.supplier_specials_rearm_reminder();
ALTER TABLE public.supplier_specials DROP COLUMN IF EXISTS ending_reminder_for, DROP COLUMN IF EXISTS units_left, DROP COLUMN IF EXISTS while_stocks_last;
-- Then: git revert the matching commit and publish.
