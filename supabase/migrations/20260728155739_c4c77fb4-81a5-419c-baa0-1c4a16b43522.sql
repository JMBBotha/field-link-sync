
-- 1) Backfill quote numbers for any quotes still missing one.
UPDATE public.quotes
   SET quote_number = public.generate_quote_number()
 WHERE quote_number IS NULL OR quote_number = '';

-- 2) Migrate legacy quote_line_items → quote_items for quotes without any quote_items yet.
INSERT INTO public.quote_items
  (id, quote_id, item_name, description, quantity, unit_price, total_price,
   is_bundle, item_type, source, sort_order, metadata, created_at)
SELECT
  gen_random_uuid(),
  qli.quote_id,
  COALESCE(NULLIF(qli.description, ''), 'Item') AS item_name,
  qli.description,
  COALESCE(qli.quantity, 1),
  COALESCE(qli.unit_price, 0),
  COALESCE(qli.total, qli.quantity * qli.unit_price),
  false,
  'line',
  'legacy_migration',
  ROW_NUMBER() OVER (PARTITION BY qli.quote_id ORDER BY qli.created_at NULLS LAST, qli.id) - 1,
  jsonb_build_object('legacy_id', qli.id, 'legacy_service_id', qli.service_id),
  COALESCE(qli.created_at, now())
FROM public.quote_line_items qli
WHERE NOT EXISTS (
  SELECT 1 FROM public.quote_items qi WHERE qi.quote_id = qli.quote_id
);

-- 3) Orphan quotes (have a total but no items in either table) get a placeholder row
--    so the recorded total is preserved and the user knows to rebuild the quote.
INSERT INTO public.quote_items
  (id, quote_id, item_name, description, quantity, unit_price, total_price,
   is_bundle, item_type, source, sort_order, metadata)
SELECT
  gen_random_uuid(),
  q.id,
  'Legacy quote — please re-enter items',
  'This quote was created in the old builder. The recorded total is preserved below; open the quote and rebuild the line items in the unified builder.',
  1,
  COALESCE(q.subtotal, q.total, 0),
  COALESCE(q.subtotal, q.total, 0),
  false,
  'placeholder',
  'legacy_placeholder',
  0,
  jsonb_build_object('recovered_total', q.total, 'recovered_subtotal', q.subtotal)
FROM public.quotes q
WHERE COALESCE(q.total, 0) > 0
  AND NOT EXISTS (SELECT 1 FROM public.quote_items      qi  WHERE qi.quote_id  = q.id)
  AND NOT EXISTS (SELECT 1 FROM public.quote_line_items qli WHERE qli.quote_id = q.id);

-- 4) Recompute-totals trigger: keep quotes.subtotal / vat_amount / total in sync with quote_items.
CREATE OR REPLACE FUNCTION public.recalc_quote_totals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote_id uuid;
  v_subtotal numeric;
  v_rate numeric;
  v_discount_type text;
  v_discount_value numeric;
  v_discount_amount numeric;
BEGIN
  v_quote_id := COALESCE(NEW.quote_id, OLD.quote_id);
  IF v_quote_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(SUM(COALESCE(total_price, quantity * unit_price)), 0)
    INTO v_subtotal
    FROM public.quote_items
   WHERE quote_id = v_quote_id
     AND parent_item_id IS NULL;

  SELECT COALESCE(vat_rate, 0.15), discount_type, COALESCE(discount_value, 0)
    INTO v_rate, v_discount_type, v_discount_value
    FROM public.quotes
   WHERE id = v_quote_id;

  IF v_discount_type IN ('percent', 'percentage') THEN
    v_discount_amount := v_subtotal * (v_discount_value / 100.0);
  ELSIF v_discount_type = 'fixed' THEN
    v_discount_amount := v_discount_value;
  ELSE
    v_discount_amount := 0;
  END IF;

  UPDATE public.quotes
     SET subtotal   = v_subtotal,
         vat_amount = ROUND((v_subtotal - v_discount_amount) * v_rate, 2),
         total      = ROUND((v_subtotal - v_discount_amount) * (1 + v_rate), 2),
         updated_at = now()
   WHERE id = v_quote_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_quote_totals ON public.quote_items;
CREATE TRIGGER trg_recalc_quote_totals
AFTER INSERT OR UPDATE OR DELETE ON public.quote_items
FOR EACH ROW EXECUTE FUNCTION public.recalc_quote_totals();

-- 5) Lock legacy table to reads-only. Keep SELECT so any residual code can still display until cutover completes.
REVOKE INSERT, UPDATE, DELETE ON public.quote_line_items FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.quote_line_items FROM anon;
-- service_role retains full privileges for backup/rollback tooling.
