ALTER TABLE public.supplier_products ADD COLUMN IF NOT EXISTS pipe_sizes_manual boolean NOT NULL DEFAULT false;

UPDATE public.supplier_products SET pipe_sizes_manual = true WHERE id = '0fe60b4f-1f17-4d42-8ff0-899ba291c0e4';

WITH parsed AS (
  SELECT sp.id, array_agg(DISTINCT f ORDER BY f) AS fr
  FROM public.supplier_products sp,
       LATERAL (SELECT (m[1] || '/' || m[2]) AS f FROM regexp_matches(sp.pipe_size, '(?<![0-9&])([1357])\s*/\s*([248])(?![0-9])', 'g') AS m) x
  WHERE sp.pipe_sizes_manual = false AND sp.pipe_liquid IS NULL AND sp.pipe_gas IS NULL AND sp.pipe_size IS NOT NULL
    AND x.f IN ('1/4','3/8','1/2','5/8','3/4','7/8')
  GROUP BY sp.id
), pairs AS (
  SELECT id,
    (SELECT f FROM unnest(fr) f ORDER BY split_part(f,'/',1)::numeric / split_part(f,'/',2)::numeric LIMIT 1) AS small,
    (SELECT f FROM unnest(fr) f ORDER BY split_part(f,'/',1)::numeric / split_part(f,'/',2)::numeric DESC LIMIT 1) AS big
  FROM parsed WHERE array_length(fr, 1) = 2
)
UPDATE public.supplier_products sp SET pipe_liquid = p.small, pipe_gas = p.big
FROM pairs p WHERE sp.id = p.id;