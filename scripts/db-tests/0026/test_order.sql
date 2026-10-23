\set ON_ERROR_STOP 1
-- 9 trigger order flipped (old triggers fire BEFORE the invoice trigger): same-tx cleanup still leaves one alert
DROP TRIGGER on_quote_accepted ON quotes;
CREATE TRIGGER zz_on_quote_accepted AFTER UPDATE ON public.quotes FOR EACH ROW EXECUTE FUNCTION public.create_invoice_from_accepted_quote();
DO $$ DECLARE q uuid := mkq('Q-A9'); BEGIN
  UPDATE quotes SET status='accepted' WHERE id=q;
  PERFORM ok((SELECT count(*) FROM accept_notices(q) WHERE user_id='11111111-1111-1111-1111-111111111111')=1
         AND (SELECT type FROM accept_notices(q) WHERE user_id='11111111-1111-1111-1111-111111111111')='quote_accepted_send_invoice','9 reversed trigger order -> still 1 alert for rep');
END $$;
-- older notices from earlier transactions are never touched
DO $$ BEGIN PERFORM ok((SELECT count(*) FROM notifications WHERE title='Quote Accepted' AND related_id=(SELECT id FROM quotes WHERE quote_number='Q-B0'))=1,'9 old notices from before are kept'); END $$;
DROP TRIGGER zz_on_quote_accepted ON quotes;
CREATE TRIGGER on_quote_accepted AFTER UPDATE ON public.quotes FOR EACH ROW EXECUTE FUNCTION public.create_invoice_from_accepted_quote();
