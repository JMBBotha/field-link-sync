update public.product_media p set specs = b.specs, notes = b.notes
from public.product_media_specs_backup_20261026 b where p.model_key = b.model_key;
drop table if exists public.product_media_specs_backup_20261026;
