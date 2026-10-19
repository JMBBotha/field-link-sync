-- Rollback: Samsung whole-rand incl prices (Johan 19 Oct 2026 15:32/15:39 SAST)
-- Restores price_excl_vat / sell_price_incl_vat / vat_amount on the 36 Samsung rows (all were NULL) and the original fl_shop_sell_ex.
-- cost_price, markups and selling_price were never changed.
-- BEFORE (2026-10-19 ~15:45 SAST): code | cost_price | selling_price | price_excl_vat | sell_price_incl_vat | vat_amount | shop
-- AC026RNNDKG/EU | 17112.34 | 21390.43 | None | None | None | False
-- AC035RN1DKG/EU | 16973.22 | 21216.53 | None | None | None | False
-- AC071RN4DKG/EU | 21912.34 | 27390.43 | None | None | None | False
-- AC071RNMDKG/EU | 20173.22 | 25216.53 | None | None | None | False
-- AC071RNNDKG/EU | 21912.34 | 27390.43 | None | None | None | False
-- AC071TNXDKG/EU | 18503.66 | 23129.58 | None | None | None | False
-- AC100RN4DKG/EU | 27894.96 | 34868.7 | None | None | None | False
-- AC100RN4PKG/EU | 29703.66 | 37129.58 | None | None | None | False
-- AC100RNCDKG/EU | 28729.74 | 35912.18 | None | None | None | False
-- AC100RNMDKG/EU | 26016.7 | 32520.88 | None | None | None | False
-- AC160BE4EH/AF | 39860.18 | 49825.23 | None | None | None | False
-- AJ025TNAPKH/EA | 3616.7 | 4520.88 | None | None | None | False
-- AJ050TXJ2KH/EA | 12103.66 | 15129.58 | None | None | None | False
-- AJ052TN1DKH/EA | 8973.22 | 11216.53 | None | None | None | False
-- AJ052TNNDKH/EA | 8973.22 | 11216.53 | None | None | None | False
-- AJ080TXJ4KH/EA | 18573.22 | 23216.53 | None | None | None | False
-- AJ100TXJ5KH/EA | 23373.22 | 29216.53 | None | None | None | False
-- AJ125TXJ5KH/EA | 28660.18 | 35825.23 | None | None | None | False
-- AR09BSHCMWK/FA | 9042.78 | 11303.48 | None | None | None | True
-- AR09CQHGAWK/FA | 5564.52 | 6955.65 | None | None | None | True
-- AR12BSHCMWK/FA | 9877.57 | 12346.96 | None | None | None | True
-- AR12CQHGAWK/FA | 6051.48 | 7564.35 | None | None | None | True
-- AR18BSAAAWK/FA | 18155.82 | 22694.78 | None | None | None | True
-- AR18BSHCMWK/FA | 12660.18 | 15825.23 | None | None | None | True
-- AR18CQHGAWK/FA | 8973.22 | 11216.53 | None | None | None | True
-- AR24BSAAAWK/FA | 21355.82 | 26694.78 | None | None | None | True
-- AR24BSHCMWK/FA | 15512.34 | 19390.43 | None | None | None | True
-- AR24BSHGAWK/FA | 15512.34 | 19390.43 | None | None | None | False
-- AR24CQHGAWK/FA | 11825.39 | 14781.74 | None | None | None | True
-- AR40F09C0AG/FA | 6955.82 | 8694.78 | None | None | None | True
-- AR40F12C0AG/FA | 7790.61 | 9738.26 | None | None | None | True
-- AR40F18C0AG/FA | 11129.74 | 13912.18 | None | None | None | True
-- AR40F24C0AG/FA | 14260.18 | 17825.23 | None | None | None | True
-- AR70F18C1FW/FA | 15303.66 | 19129.58 | None | None | None | False
-- AR80F18CADW/FA | 18503.66 | 23129.58 | None | None | None | False
-- AR80F24CADW/FA | 21773.22 | 27216.53 | None | None | None | False

UPDATE public.supplier_products SET price_excl_vat = NULL, sell_price_incl_vat = NULL, vat_amount = NULL WHERE brand = 'Samsung' AND id IN ('152a4596-a517-4219-8770-4a3c450715eb','4e54657f-da9c-429f-a0e6-71ca9f4ee9b3','78f9dbca-86dd-43cf-b0ba-0204eca8f1d7','ca774adc-8db8-47a7-ba3b-0c9e342a3ace','ed01f0ce-ae47-414a-84d5-c6b237c6bdaf','fb1879cf-ac65-4eeb-8462-513f54b21b5f','5ed53765-430e-4616-b807-4da7b6c5214e','45a4eb71-8423-4c56-b6a5-fa6f5906768b','c36b22b0-ad4e-4bfd-84e1-7cc23dcf4bd6','6d7a7243-d40d-406f-82d2-aaa7afa3ba98','92500bef-a505-4bae-9120-bf9caa038131','eca6627b-d558-421d-9cb8-b5758912ebba','cd2531b8-ef6a-4945-9868-839da99b9e9e','33742e1f-10ef-478c-b621-fa8d32efea4b','c81a4442-8dcc-47af-9617-ff319e8b6d28','e62af007-14d2-4711-a7c1-0fee103cecdf','73077d51-7b5a-41e3-8f76-d37704ef87d6','0869b143-b3c4-4d7a-8c8c-c56ede8193a2','e9f788f4-71e5-45ef-b704-e759c1b90e9f','ac70f32f-d8b8-4468-a296-60ad0e911301','7dbfc582-523f-4214-b8a7-dccc16a74b09','df10f839-c30c-45c2-aa84-7e88c4d9a412','737e350b-248b-4c16-a9f1-8a4ba40709b4','9989e744-a0a8-4386-9e37-a4b07a6b015a','26fc95ba-8176-4f0c-b9b8-f9fabdaffce7','683f3d57-7bef-4a4f-8b98-3de550cc6cc8','a6966b77-d65e-492b-86e8-e0b02f01956e','72cc7e69-6020-450e-a245-fade263df83c','46a63f1f-ce14-4430-8e3b-1b2b0c340514','5e71b68b-69e9-40f2-9cda-8023e5f4d10b','0a6072b3-caa0-4baa-9b48-dc18f12bd9d7','e0104d03-1bad-4622-9629-d735f3301707','a4823d77-beef-4d09-814f-b9c39b194e6c','49d80515-6453-4e21-9dd6-ba7556e4af21','5c8bac77-c603-443e-a898-4520f3eec2fd','e0d7fa2e-d4d2-4d87-b3a3-d385ef7e8bf4');

CREATE OR REPLACE FUNCTION public.fl_shop_sell_ex(p_company uuid, p_product uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
           WHEN sp.id IS NULL OR NOT coalesce(sp.is_active, false) OR coalesce(sp.archived, false) OR coalesce(sp.is_price_on_request, false) THEN NULL
           WHEN coalesce(sp.selling_price, 0) > 0 THEN round(sp.selling_price, 2)
           WHEN coalesce(sp.cost_price, 0) > 0 THEN round(sp.cost_price * (1 + coalesce(c.units_markup_percent, 25) / 100.0), 2)
           ELSE NULL END
  FROM (SELECT 1) one
  LEFT JOIN public.supplier_products sp ON sp.id = p_product
  LEFT JOIN public.companies c ON c.id = p_company
$function$
;
