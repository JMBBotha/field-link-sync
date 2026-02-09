
-- Add subscription fields to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'trial',
  ADD COLUMN IF NOT EXISTS subscription_plan text NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS jobs_limit integer NOT NULL DEFAULT 50;

-- Set trial_ends_at for existing users to 14 days from now
UPDATE public.profiles
SET trial_ends_at = now() + interval '14 days'
WHERE trial_ends_at IS NULL;

-- Set default trial_ends_at for new signups via trigger
CREATE OR REPLACE FUNCTION public.set_trial_defaults()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.trial_ends_at IS NULL THEN
    NEW.trial_ends_at := now() + interval '14 days';
  END IF;
  IF NEW.subscription_status IS NULL THEN
    NEW.subscription_status := 'trial';
  END IF;
  IF NEW.subscription_plan IS NULL THEN
    NEW.subscription_plan := 'free';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER set_profile_trial_defaults
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_trial_defaults();
