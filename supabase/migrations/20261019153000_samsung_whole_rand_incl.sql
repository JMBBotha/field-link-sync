-- Samsung whole-rand incl prices (Johan 19 Oct 2026 15:32 + 15:39 SAST). Shared catalogue (no company_id): applies to every company.
-- 27 live Samsung rows whose incl was 1-2c off a whole rand + 9 more Samsung units used by the online shop (their unit incl already
-- rounded to .00, but room totals drifted a cent). cost_price / markups / selling_price untouched.
-- incl of record = round(selling_price * 1.15) to whole rand; excl column is numeric(12,2) so it holds round(incl/1.15, 2).
-- Rollback: docs/db-releases/2026-10-19_samsung_whole_rand_rollback.sql
UPDATE public.supplier_products
   SET sell_price_incl_vat = round(selling_price * 1.15),
       price_excl_vat      = round(round(selling_price * 1.15) / 1.15, 2),
       vat_amount          = round(selling_price * 1.15) - round(round(selling_price * 1.15) / 1.15, 2)
 WHERE brand = 'Samsung' AND id IN ('152a4596-a517-4219-8770-4a3c450715eb','4e54657f-da9c-429f-a0e6-71ca9f4ee9b3','78f9dbca-86dd-43cf-b0ba-0204eca8f1d7','ca774adc-8db8-47a7-ba3b-0c9e342a3ace','ed01f0ce-ae47-414a-84d5-c6b237c6bdaf','fb1879cf-ac65-4eeb-8462-513f54b21b5f','5ed53765-430e-4616-b807-4da7b6c5214e','45a4eb71-8423-4c56-b6a5-fa6f5906768b','c36b22b0-ad4e-4bfd-84e1-7cc23dcf4bd6','6d7a7243-d40d-406f-82d2-aaa7afa3ba98','92500bef-a505-4bae-9120-bf9caa038131','eca6627b-d558-421d-9cb8-b5758912ebba','cd2531b8-ef6a-4945-9868-839da99b9e9e','33742e1f-10ef-478c-b621-fa8d32efea4b','c81a4442-8dcc-47af-9617-ff319e8b6d28','e62af007-14d2-4711-a7c1-0fee103cecdf','73077d51-7b5a-41e3-8f76-d37704ef87d6','0869b143-b3c4-4d7a-8c8c-c56ede8193a2','e9f788f4-71e5-45ef-b704-e759c1b90e9f','ac70f32f-d8b8-4468-a296-60ad0e911301','7dbfc582-523f-4214-b8a7-dccc16a74b09','df10f839-c30c-45c2-aa84-7e88c4d9a412','737e350b-248b-4c16-a9f1-8a4ba40709b4','9989e744-a0a8-4386-9e37-a4b07a6b015a','26fc95ba-8176-4f0c-b9b8-f9fabdaffce7','683f3d57-7bef-4a4f-8b98-3de550cc6cc8','a6966b77-d65e-492b-86e8-e0b02f01956e','72cc7e69-6020-450e-a245-fade263df83c','46a63f1f-ce14-4430-8e3b-1b2b0c340514','5e71b68b-69e9-40f2-9cda-8023e5f4d10b','0a6072b3-caa0-4baa-9b48-dc18f12bd9d7','e0104d03-1bad-4622-9629-d735f3301707','a4823d77-beef-4d09-814f-b9c39b194e6c','49d80515-6453-4e21-9dd6-ba7556e4af21','5c8bac77-c603-443e-a898-4520f3eec2fd','e0d7fa2e-d4d2-4d87-b3a3-d385ef7e8bf4')
   AND abs(selling_price * 1.15 - round(selling_price * 1.15)) < 0.025;

-- Shop: when a product carries an incl price of record that still matches its live sell price (within 2c), the shop uses
-- excl = incl / 1.15 at 4 dp, so unit, room and order totals incl VAT come out on the whole rand. Stale incl values are ignored.
CREATE OR REPLACE FUNCTION public.fl_shop_sell_ex(p_company uuid, p_product uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
           WHEN sp.id IS NULL OR NOT coalesce(sp.is_active, false) OR coalesce(sp.archived, false) OR coalesce(sp.is_price_on_request, false) THEN NULL
           WHEN coalesce(sp.selling_price, 0) > 0 AND coalesce(sp.sell_price_incl_vat, 0) > 0
                AND abs(round(sp.selling_price, 2) - sp.sell_price_incl_vat / 1.15) <= 0.02 THEN round(sp.sell_price_incl_vat / 1.15, 4)
           WHEN coalesce(sp.selling_price, 0) > 0 THEN round(sp.selling_price, 2)
           WHEN coalesce(sp.cost_price, 0) > 0 THEN round(sp.cost_price * (1 + coalesce(c.units_markup_percent, 25) / 100.0), 2)
           ELSE NULL END
  FROM (SELECT 1) one
  LEFT JOIN public.supplier_products sp ON sp.id = p_product
  LEFT JOIN public.companies c ON c.id = p_company
$function$;
