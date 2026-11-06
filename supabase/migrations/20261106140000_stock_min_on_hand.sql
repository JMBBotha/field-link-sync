-- Optional minimum on the existing stock item. Null means nobody has set one.
-- The admin-home stock glance shows it when it is filled in. It does not reorder or change quantities.
-- Not applied by the glance change itself.

ALTER TABLE public.cf_stock_items
  ADD COLUMN IF NOT EXISTS min_on_hand numeric;

COMMENT ON COLUMN public.cf_stock_items.min_on_hand IS
  'Optional minimum in stock units for the admin stock glance. Null = not set.';
