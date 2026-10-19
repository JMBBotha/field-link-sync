-- Rollback: Massair CT fixed-install items product_type change (Johan approved 19 Oct 2026 09:20 SAST)
-- Change applied: product_type 'ac_unit' -> 'labour' on the 4 rows below (book 914a7e82, supplier 8d752820 "MASSAIR CT - FIXED INSTALL PRICES").
-- Nothing else was changed. Prices untouched.
--
-- BEFORE-STATE (captured 2026-10-19 ~09:22 SAST, identical in supplier_products and live_supplier_products):
-- id                                   | product_code         | product_type | category              | product_category | cost_price | markup | selling_price | price_excl_vat | sell_incl_vat | updated_at (UTC)
-- 50e3a154-f69b-4ce7-a3d0-bdb4a7a1c311 | STD-B2B-INST-09-12K  | ac_unit      | Labour & Installation | Installation     | 2061.19    | 35/35  | 2782.61       | 2782.61        | 3200.00       | 2026-10-18 19:57:35.51193+00
-- 5018e89a-9761-4358-a097-9a493a396600 | STD-B2B-INST-18-24K  | ac_unit      | Labour & Installation | Installation     | 2254.43    | 35/35  | 3043.48       | 3043.48        | 3500.00       | 2026-10-18 19:58:13.254699+00
-- aed0279d-0444-4ef6-8d68-ae73ecc013df | STD-B2B-INST-36K     | ac_unit      | Labour & Installation | Installation     | 2447.67    | 35/35  | 3304.35       | 3304.35        | 3800.00       | 2026-10-18 19:58:13.254699+00
-- 347af8cd-8c4b-4ee5-b744-b9cb33a2457e | ELEC-ISO-DB-ALLOW    | ac_unit      | Labour & Installation | Installation     | 1629.63    | 35/35  | 2200.00       | 2200.00        | 2530.00       | 2026-10-18 19:58:13.254699+00
-- quote_items referencing these 4 products at time of change: 0

UPDATE public.supplier_products
   SET product_type = 'ac_unit'
 WHERE id IN ('50e3a154-f69b-4ce7-a3d0-bdb4a7a1c311','5018e89a-9761-4358-a097-9a493a396600',
              'aed0279d-0444-4ef6-8d68-ae73ecc013df','347af8cd-8c4b-4ee5-b744-b9cb33a2457e')
   AND pdf_upload_id = '914a7e82-9557-48fe-8bb7-95988b695951'
   AND product_type = 'labour';
