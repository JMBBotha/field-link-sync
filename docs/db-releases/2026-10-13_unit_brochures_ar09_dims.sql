-- AR09BSHGAWK/FA net sizes/weights from the Fourways Samsung AR4500 range sheet ("Net Dimension"/"Net Weight" rows). Data only; status unchanged (draft).
UPDATE public.product_media SET specs = specs || '{"indoor_dim_mm":"790x275x200","outdoor_dim_mm":"782x540x320","indoor_net_kg":9.0,"outdoor_net_kg":27.0}'::jsonb
 WHERE model_key = 'AR09BSHGAWK/FA' RETURNING model_key, status, specs;
