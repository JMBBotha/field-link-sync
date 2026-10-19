-- Website step 1 (Johan 2026-10-19 06:26): lead intake hardening for the 0800-BE-COOL website.
-- 1) lead_source gets 'website_shop' (paid online shop orders). Additive; an enum value cannot be dropped on rollback.
ALTER TYPE public.lead_source ADD VALUE IF NOT EXISTS 'website_shop';

-- 2) Per-IP rate limit for public website endpoints. Stores a salted SHA-256 of the IP only, never the raw address.
CREATE TABLE IF NOT EXISTS public.website_rate_limits (
  id bigserial PRIMARY KEY,
  endpoint text NOT NULL,
  ip_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS website_rate_limits_lookup ON public.website_rate_limits (endpoint, ip_hash, created_at DESC);
ALTER TABLE public.website_rate_limits ENABLE ROW LEVEL SECURITY; -- no policies: service_role only
REVOKE ALL ON TABLE public.website_rate_limits FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.website_rate_limits_id_seq FROM PUBLIC, anon, authenticated;

-- true = allowed (hit recorded), false = over the limit. Old rows (>1 day) are pruned as we go.
CREATE OR REPLACE FUNCTION public.fl_website_rate_hit(p_endpoint text, p_ip_hash text, p_max integer, p_window_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_n integer;
BEGIN
  IF p_endpoint IS NULL OR p_ip_hash IS NULL OR p_max IS NULL OR p_max < 1 THEN RETURN true; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('wrl:' || p_endpoint || ':' || p_ip_hash, 0));
  IF random() < 0.02 THEN
    DELETE FROM public.website_rate_limits WHERE created_at < now() - interval '1 day';
  END IF;
  SELECT count(*) INTO v_n FROM public.website_rate_limits
   WHERE endpoint = p_endpoint AND ip_hash = p_ip_hash
     AND created_at > now() - make_interval(secs => greatest(p_window_seconds, 1));
  IF v_n >= p_max THEN RETURN false; END IF;
  INSERT INTO public.website_rate_limits (endpoint, ip_hash) VALUES (left(p_endpoint, 40), left(p_ip_hash, 64));
  RETURN true;
END $f$;
REVOKE ALL ON FUNCTION public.fl_website_rate_hit(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fl_website_rate_hit(text, text, integer, integer) TO service_role;
