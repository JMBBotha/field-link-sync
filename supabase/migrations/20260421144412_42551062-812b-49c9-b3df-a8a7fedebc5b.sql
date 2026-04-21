-- Audit findings storage
CREATE TABLE public.overlay_audit_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  triggered_by text NOT NULL DEFAULT 'cron',
  suppliers_scanned text[] NOT NULL DEFAULT '{}',
  total_products integer NOT NULL DEFAULT 0,
  total_findings integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running',
  error text
);

CREATE TABLE public.overlay_audit_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.overlay_audit_runs(id) ON DELETE CASCADE,
  supplier_id uuid,
  supplier_name text,
  product_id uuid,
  product_code text,
  short_name text,
  page_number integer,
  expected_page_number integer,
  expected_bbox jsonb,
  actual_bbox jsonb,
  issue_type text NOT NULL,
  severity text NOT NULL DEFAULT 'warn',
  details text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_overlay_findings_run ON public.overlay_audit_findings(run_id);
CREATE INDEX idx_overlay_findings_issue ON public.overlay_audit_findings(issue_type, severity);
CREATE INDEX idx_overlay_findings_supplier ON public.overlay_audit_findings(supplier_id, product_code);
CREATE INDEX idx_overlay_runs_started ON public.overlay_audit_runs(started_at DESC);

ALTER TABLE public.overlay_audit_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.overlay_audit_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view audit runs"
  ON public.overlay_audit_runs FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can view audit findings"
  ON public.overlay_audit_findings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Track which suppliers to audit
CREATE TABLE public.overlay_audit_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_name text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.overlay_audit_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage audit config"
  ON public.overlay_audit_config FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.overlay_audit_config (supplier_name, enabled)
VALUES ('DAIKIN AIR CONDITIONING', true)
ON CONFLICT (supplier_name) DO NOTHING;