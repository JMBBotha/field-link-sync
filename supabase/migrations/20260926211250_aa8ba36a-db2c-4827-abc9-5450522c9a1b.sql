CREATE TABLE public.mandy_voice_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  company_id uuid,
  channel text NOT NULL DEFAULT 'quote_mode',
  quote_id uuid,
  transcript text,
  plan jsonb,
  matches jsonb,
  status text NOT NULL DEFAULT 'planned',
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.mandy_voice_logs TO authenticated;
GRANT ALL ON public.mandy_voice_logs TO service_role;
ALTER TABLE public.mandy_voice_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users insert own voice logs" ON public.mandy_voice_logs FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND (company_id IS NULL OR company_id = (SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid())));
CREATE POLICY "Users update own voice logs" ON public.mandy_voice_logs FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Admins read voice logs" ON public.mandy_voice_logs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') AND (company_id IS NULL OR company_id = (SELECT p.company_id FROM public.profiles p WHERE p.id = auth.uid())));
CREATE TRIGGER mandy_voice_logs_updated_at BEFORE UPDATE ON public.mandy_voice_logs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();