-- Rollback for 20261013114500_unit_brochures.sql (unit brochure pages). Code rollback = revert the commit.
DROP FUNCTION IF EXISTS public.public_unit_brochure(text, uuid);
-- Undo the AR09BSHGAWK/FA net size/weight fill (data only):
UPDATE public.product_media SET specs = specs - 'indoor_dim_mm' - 'outdoor_dim_mm' - 'indoor_net_kg' - 'outdoor_net_kg' WHERE model_key = 'AR09BSHGAWK/FA';
