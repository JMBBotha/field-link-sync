CREATE TABLE public.mandy_undo_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  action text NOT NULL,
  label text,
  snapshot jsonb NOT NULL,
  quote_updated_at_after timestamptz,
  state_hash_after text,
  used_at timestamptz
);
CREATE INDEX mandy_undo_snapshots_quote_idx ON public.mandy_undo_snapshots (quote_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mandy_undo_snapshots TO authenticated;
GRANT ALL ON public.mandy_undo_snapshots TO service_role;
ALTER TABLE public.mandy_undo_snapshots ENABLE ROW LEVEL SECURITY;
-- Access follows the quote: RLS on quotes decides visibility (subquery runs under quotes' own policies).
CREATE POLICY "Undo snapshots follow quote read access" ON public.mandy_undo_snapshots FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_id));
CREATE POLICY "Undo snapshots insert own on visible quote" ON public.mandy_undo_snapshots FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_id));
CREATE POLICY "Undo snapshots update own" ON public.mandy_undo_snapshots FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.quotes q WHERE q.id = quote_id))
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "Undo snapshots delete own" ON public.mandy_undo_snapshots FOR DELETE TO authenticated
  USING (user_id = auth.uid());