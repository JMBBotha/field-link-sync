DO $$
DECLARE kits uuid[] := ARRAY['6d2c5671-34cd-4dd7-bdaf-ffe5442cd63a','5ae3c7a2-cea3-48af-b544-77020a52b334','ac85e463-dc7b-43ba-aad9-0e99ce79eafe','6b62cd9f-57b9-4c88-8bf3-f50164b1b139','b64c8277-e3eb-41ee-8d77-16314caae04e']::uuid[];
  tape uuid; k uuid;
BEGIN
  SELECT id INTO tape FROM public.supplier_products WHERE product_code='TAPE006' AND id IN (SELECT supplier_product_id FROM public.bundle_items WHERE bundle_id = ANY(kits)) LIMIT 1;
  UPDATE public.bundle_items SET length_metres = 0.3333333333, quantity = 0.3333333333
   WHERE bundle_id = ANY(kits) AND supplier_product_id IN (SELECT id FROM public.supplier_products WHERE product_code='TAPE006');

  UPDATE public.bundle_items SET unit_type='m', price_per_unit_qty=1, price_per_unit_label='m', allows_decimal_qty=true, qty_step=0.1, min_qty=0
   WHERE bundle_id='b64c8277-e3eb-41ee-8d77-16314caae04e' AND is_length_item = true;

  FOREACH k IN ARRAY kits LOOP
    IF NOT EXISTS (SELECT 1 FROM public.bundle_items WHERE bundle_id=k AND supplier_product_id='582f17df-3727-413b-820d-5b9d383d7e38') THEN
      INSERT INTO public.bundle_items (bundle_id, supplier_product_id, quantity, length_metres, is_length_item, is_optional, unit_type, price_per_unit_qty, price_per_unit_label, allows_decimal_qty, qty_step, min_qty, sort_order)
      VALUES (k, '582f17df-3727-413b-820d-5b9d383d7e38', 2, NULL, false, false, 'pack', 100, '100 pack', false, 1, 0,
        (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM public.bundle_items WHERE bundle_id=k));
    END IF;
  END LOOP;

  UPDATE public.supplier_products SET unit_type='pack', price_per_unit_qty=100, price_per_unit_label='100 pack'
   WHERE id='880cba2d-aae9-4383-ad39-e25b8f95c57b';
END $$;