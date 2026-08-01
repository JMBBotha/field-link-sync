UPDATE public.leads l
SET latitude = cl.latitude, longitude = cl.longitude
FROM public.customer_locations cl
WHERE cl.customer_id = l.customer_id
  AND cl.is_primary = true
  AND cl.latitude IS NOT NULL AND cl.longitude IS NOT NULL
  AND cl.latitude <> 0 AND cl.longitude <> 0
  AND (l.latitude IS NULL OR l.longitude IS NULL OR (l.latitude = 0 AND l.longitude = 0));

UPDATE public.jobs j
SET lat = cl.latitude, lng = cl.longitude
FROM public.customer_locations cl
WHERE cl.customer_id = j.customer_id
  AND cl.is_primary = true
  AND cl.latitude IS NOT NULL AND cl.longitude IS NOT NULL
  AND cl.latitude <> 0 AND cl.longitude <> 0
  AND (j.lat IS NULL OR j.lng IS NULL OR (j.lat = 0 AND j.lng = 0));

UPDATE public.leads SET latitude = NULL, longitude = NULL WHERE latitude = 0 AND longitude = 0;
UPDATE public.jobs SET lat = NULL, lng = NULL WHERE lat = 0 AND lng = 0;