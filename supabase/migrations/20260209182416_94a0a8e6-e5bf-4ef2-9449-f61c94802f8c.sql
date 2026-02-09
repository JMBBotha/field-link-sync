
-- FIX 1: customer_tokens - Remove public SELECT, restrict to admins only
DROP POLICY IF EXISTS "Anyone can verify tokens" ON public.customer_tokens;

CREATE POLICY "Admins can view customer tokens"
ON public.customer_tokens FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- FIX 2: profiles - Remove public SELECT, require authentication
DROP POLICY IF EXISTS "Users can view all profiles" ON public.profiles;

CREATE POLICY "Authenticated users can view profiles"
ON public.profiles FOR SELECT
TO authenticated
USING (auth.uid() IS NOT NULL);

-- FIX 3: notification_logs - Restrict INSERT to authenticated users with roles
DROP POLICY IF EXISTS "System can create notification logs" ON public.notification_logs;

CREATE POLICY "Authenticated staff can create notification logs"
ON public.notification_logs FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role) OR
  public.has_role(auth.uid(), 'field_agent'::app_role)
);

-- FIX 4: job-photos storage - Make bucket private, restrict to authenticated staff
UPDATE storage.buckets SET public = false WHERE id = 'job-photos';

DROP POLICY IF EXISTS "Anyone can view job photos" ON storage.objects;

CREATE POLICY "Authenticated staff can view job photos"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'job-photos' AND
  (
    public.has_role(auth.uid(), 'admin'::app_role) OR
    public.has_role(auth.uid(), 'field_agent'::app_role)
  )
);

-- FIX 5: Also fix overly permissive RLS policies flagged by linter
-- Check for any INSERT/UPDATE/DELETE with USING(true) on notification_queue
DROP POLICY IF EXISTS "System can insert notification queue" ON public.notification_queue;

CREATE POLICY "Authenticated staff can insert notification queue"
ON public.notification_queue FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role) OR
  public.has_role(auth.uid(), 'field_agent'::app_role)
);
