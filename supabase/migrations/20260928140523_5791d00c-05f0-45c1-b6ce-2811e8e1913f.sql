CREATE TABLE public.labour_norms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  hours numeric NOT NULL CHECK (hours >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.labour_norms IS 'Master-company global labour hour norms (PROPOSED defaults, pending Johan review). Used only for non-blocking pricing-check chips.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.labour_norms TO authenticated;
GRANT ALL ON public.labour_norms TO service_role;
ALTER TABLE public.labour_norms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "labour_norms read" ON public.labour_norms FOR SELECT TO authenticated USING (public.can_read_master_catalog(auth.uid()));
CREATE POLICY "labour_norms insert" ON public.labour_norms FOR INSERT TO authenticated WITH CHECK (public.can_write_master_catalog(auth.uid()));
CREATE POLICY "labour_norms update" ON public.labour_norms FOR UPDATE TO authenticated USING (public.can_write_master_catalog(auth.uid())) WITH CHECK (public.can_write_master_catalog(auth.uid()));
CREATE POLICY "labour_norms delete" ON public.labour_norms FOR DELETE TO authenticated USING (public.can_write_master_catalog(auth.uid()));

CREATE TRIGGER labour_norms_updated_at BEFORE UPDATE ON public.labour_norms FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.labour_norms (key, label, hours, sort_order) VALUES
('split_upto_12k','Split wall install up to 12k BTU (proposed)',4,1),
('split_18_24k','Split wall install 18k–24k BTU (proposed)',5,2),
('split_30k_plus','Split wall install 30k BTU+ (proposed)',6,3),
('cassette_install','Cassette install (proposed)',8,4),
('underceiling_install','Under ceiling install (proposed)',8,5),
('ducted_install','Ducted / hideaway install (proposed)',12,6),
('package_install','Package unit install (proposed)',8,7),
('removal','Removal of existing unit (proposed)',1.5,8),
('removal_reinstall','Removal and reinstallation (proposed)',5,9),
('service_split','Service split wall unit (proposed)',1,10),
('service_cassette_hideaway','Service cassette / hideaway (proposed)',2,11),
('service_ducted','Service ducted system (proposed)',2.5,12),
('pcb','PC board replacement (proposed)',1.5,13),
('electrical','Isolator / electrical fault repair (proposed)',1.5,14),
('repair','Repair / diagnosis (proposed)',2,15),
('piping_extra_per_m','Extra per metre of piping beyond the standard kit (proposed, per m)',0.25,16);