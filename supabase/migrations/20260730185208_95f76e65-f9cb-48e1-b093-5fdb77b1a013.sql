ALTER TABLE public.visual_proposals
  ADD COLUMN IF NOT EXISTS style jsonb NOT NULL DEFAULT '{"template":"simple","themeColor":"#1B3A5C","font":"Inter"}'::jsonb,
  ADD COLUMN IF NOT EXISTS require_signature boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS proposal_number text,
  ADD COLUMN IF NOT EXISTS proposal_date date NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS reference text;