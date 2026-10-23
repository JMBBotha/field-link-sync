-- Before 0029: an admin editing the address of a client that has a SENT invoice fails (0023 push hits trg_invoice_guard).
\set ON_ERROR_STOP on
DO $$ DECLARE e text; BEGIN
  PERFORM set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-0000-0000-0000000000a1"}', true);
  BEGIN UPDATE public.customers SET primary_address_line1 = '2 New Rd' WHERE id = 'cccccccc-0000-0000-0000-000000000001'; e := 'none';
  EXCEPTION WHEN others THEN e := SQLERRM; END;
  IF e LIKE 'Invoice INV-T4 is sent and locked%' THEN RAISE NOTICE 'PASS: (pre-0029) reproduced 0023 bug: client address edit fails: %', e;
  ELSE RAISE EXCEPTION 'FAIL: expected 0023 failure, got %', e; END IF;
END $$;
