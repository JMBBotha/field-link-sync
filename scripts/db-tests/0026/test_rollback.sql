\set ON_ERROR_STOP 1
DO $$ DECLARE q uuid := mkq('Q-R1'); BEGIN
  UPDATE quotes SET status='accepted' WHERE id=q;
  PERFORM ok((SELECT count(*) FROM accept_notices(q) WHERE user_id='11111111-1111-1111-1111-111111111111')=3
         AND (SELECT body FROM accept_notices(q) WHERE type='quote_accepted_send_invoice' LIMIT 1) LIKE '%(deposit R 27421.32)%','R after rollback: back to 0025 behaviour (3 notices, old format)');
END $$;
