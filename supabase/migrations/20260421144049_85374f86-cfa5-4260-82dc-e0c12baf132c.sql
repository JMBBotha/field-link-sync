
CREATE TABLE public.overlay_mismatch_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_name text,
  supplier_id uuid,
  product_code text,
  page_number integer,
  stored_page_number integer,
  stored_row_bbox jsonb,
  notes text,
  status text NOT NULL DEFAULT 'open',
  reported_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);

CREATE INDEX idx_overlay_mismatch_status ON public.overlay_mismatch_reports(status, created_at DESC);

ALTER TABLE public.overlay_mismatch_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can create reports"
  ON public.overlay_mismatch_reports FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can view all reports"
  ON public.overlay_mismatch_reports FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Reporters can view own reports"
  ON public.overlay_mismatch_reports FOR SELECT
  TO authenticated
  USING (reported_by = auth.uid());

CREATE POLICY "Admins can update reports"
  ON public.overlay_mismatch_reports FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
