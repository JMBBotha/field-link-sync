
-- Fix remaining "always true" INSERT policies

-- audit_log: restrict to authenticated users (triggers run as service role anyway)
DROP POLICY IF EXISTS "System can insert audit log" ON public.audit_log;
CREATE POLICY "Authenticated users can insert audit log"
ON public.audit_log FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);

-- notifications: restrict to authenticated users  
DROP POLICY IF EXISTS "System can create notifications" ON public.notifications;
CREATE POLICY "Authenticated users can create notifications"
ON public.notifications FOR INSERT
TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);
