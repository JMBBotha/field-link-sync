-- WALDA checked bank balance. The accounts bot (same login as walda_bank_match) inserts a
-- cf_bank_balances snapshot for its own company. Older dates are left alone. The same
-- account and statement date is update-or-skip, so a retry does not add a second row.
-- Apply this file before the client that reads cf_bank_balances.source is deployed.
-- Undo: supabase/manual/20261116121500_walda_record_bank_balance_rollback.sql

ALTER TABLE public.cf_bank_balances
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS note text,
  ADD COLUMN IF NOT EXISTS source_ref text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cf_bank_balances_source_chk'
      AND conrelid = 'public.cf_bank_balances'::regclass
  ) THEN
    ALTER TABLE public.cf_bank_balances
      ADD CONSTRAINT cf_bank_balances_source_chk CHECK (source IN ('manual', 'walda'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS cf_bank_balances_walda_day
  ON public.cf_bank_balances (account_id, as_of)
  WHERE source = 'walda';

-- Digits of the stored account_ref equal the digits WALDA sends (so 563591 matches …563591).
CREATE OR REPLACE FUNCTION public._cf_bank_ref_eq(p_stored text, p_given text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT btrim(coalesce(p_given, '')) <> '' AND (
    btrim(coalesce(p_stored, '')) = btrim(p_given)
    OR (
      length(regexp_replace(btrim(p_given), '\D', '', 'g')) >= 4
      AND regexp_replace(coalesce(p_stored, ''), '\D', '', 'g')
        = regexp_replace(btrim(p_given), '\D', '', 'g')
    )
  );
$$;
REVOKE ALL ON FUNCTION public._cf_bank_ref_eq(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.walda_record_bank_balance(
  p_amount numeric,
  p_as_at date,
  p_account uuid DEFAULT NULL,
  p_account_ref text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_source_ref text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  co uuid := public._walda_co();
  v_acc public.cf_bank_accounts%ROWTYPE;
  v_old public.cf_bank_balances%ROWTYPE;
  v_new public.cf_bank_balances%ROWTYPE;
  v_amt numeric;
  v_note text;
  v_ref text;
  v_given text := nullif(btrim(p_account_ref), '');
  v_today date := (now() AT TIME ZONE 'Africa/Johannesburg')::date;
  v_n int;
  i int;
BEGIN
  IF NOT public.is_company_writable(co) THEN
    RAISE EXCEPTION 'This company is not active' USING ERRCODE = '42501';
  END IF;
  IF p_amount IS NULL OR p_amount = 'NaN'::numeric THEN
    RAISE EXCEPTION 'Amount is required' USING ERRCODE = '22023';
  END IF;
  v_amt := round(p_amount, 2);
  IF abs(v_amt) > 1000000000 THEN
    RAISE EXCEPTION 'Amount is not a bank balance' USING ERRCODE = '22023';
  END IF;
  IF p_as_at IS NULL OR p_as_at < DATE '2000-01-01' THEN
    RAISE EXCEPTION 'Statement date is required' USING ERRCODE = '22023';
  END IF;
  IF p_as_at > v_today THEN
    RAISE EXCEPTION 'Statement date cannot be in the future' USING ERRCODE = '22023';
  END IF;
  v_note := nullif(btrim(p_note), '');
  IF v_note IS NOT NULL AND length(v_note) > 500 THEN
    RAISE EXCEPTION 'Note is too long' USING ERRCODE = '22023';
  END IF;
  v_ref := nullif(btrim(p_source_ref), '');
  IF v_ref IS NOT NULL AND length(v_ref) > 120 THEN
    RAISE EXCEPTION 'Source reference is too long' USING ERRCODE = '22023';
  END IF;
  IF p_account IS NULL AND v_given IS NULL THEN
    RAISE EXCEPTION 'Give the bank account id or the account reference' USING ERRCODE = '22023';
  END IF;

  IF p_account IS NOT NULL THEN
    SELECT * INTO v_acc FROM public.cf_bank_accounts WHERE id = p_account AND company_id = co;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Bank account not found' USING ERRCODE = '42501';
    END IF;
    IF v_given IS NOT NULL AND NOT public._cf_bank_ref_eq(v_acc.account_ref, v_given) THEN
      RAISE EXCEPTION 'Account reference does not match that account' USING ERRCODE = '22023';
    END IF;
  ELSE
    SELECT count(*) INTO v_n
    FROM public.cf_bank_accounts a
    WHERE a.company_id = co AND public._cf_bank_ref_eq(a.account_ref, v_given);
    IF v_n = 0 THEN
      RAISE EXCEPTION 'Bank account not found' USING ERRCODE = '42501';
    END IF;
    IF v_n > 1 THEN
      RAISE EXCEPTION 'More than one bank account matches that reference' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_acc
    FROM public.cf_bank_accounts a
    WHERE a.company_id = co AND public._cf_bank_ref_eq(a.account_ref, v_given)
    LIMIT 1;
  END IF;

  FOR i IN 1..2 LOOP
    SELECT * INTO v_old
    FROM public.cf_bank_balances
    WHERE account_id = v_acc.id AND as_of = p_as_at AND source = 'walda'
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;
    IF FOUND THEN
      IF v_old.balance = v_amt
         AND v_old.note IS NOT DISTINCT FROM v_note
         AND v_old.source_ref IS NOT DISTINCT FROM v_ref THEN
        PERFORM public._bot_audit(co, 'bank_balance_skipped', 'cf_bank_balances', v_old.id, to_jsonb(v_old), to_jsonb(v_old));
        RETURN jsonb_build_object(
          'result', 'skipped', 'id', v_old.id, 'account_id', v_acc.id, 'account_label', v_acc.label,
          'balance', v_old.balance, 'as_at', v_old.as_of, 'source', 'walda'
        );
      END IF;
      UPDATE public.cf_bank_balances
      SET balance = v_amt, note = v_note, source_ref = v_ref, entered_by = auth.uid()
      WHERE id = v_old.id
      RETURNING * INTO v_new;
      PERFORM public._bot_audit(co, 'bank_balance_updated', 'cf_bank_balances', v_new.id, to_jsonb(v_old), to_jsonb(v_new));
      RETURN jsonb_build_object(
        'result', 'updated', 'id', v_new.id, 'account_id', v_acc.id, 'account_label', v_acc.label,
        'balance', v_new.balance, 'as_at', v_new.as_of, 'source', 'walda'
      );
    END IF;
    BEGIN
      INSERT INTO public.cf_bank_balances (company_id, account_id, balance, as_of, entered_by, source, note, source_ref)
      VALUES (co, v_acc.id, v_amt, p_as_at, auth.uid(), 'walda', v_note, v_ref)
      RETURNING * INTO v_new;
      PERFORM public._bot_audit(co, 'bank_balance_inserted', 'cf_bank_balances', v_new.id, NULL, to_jsonb(v_new));
      RETURN jsonb_build_object(
        'result', 'inserted', 'id', v_new.id, 'account_id', v_acc.id, 'account_label', v_acc.label,
        'balance', v_new.balance, 'as_at', v_new.as_of, 'source', 'walda'
      );
    EXCEPTION WHEN unique_violation THEN
      IF i = 2 THEN RAISE; END IF;
    END;
  END LOOP;
  RAISE EXCEPTION 'Could not record the bank balance';
END $$;

REVOKE ALL ON FUNCTION public.walda_record_bank_balance(numeric, date, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.walda_record_bank_balance(numeric, date, uuid, text, text, text) TO authenticated;
