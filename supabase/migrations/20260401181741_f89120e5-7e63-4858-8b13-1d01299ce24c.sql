
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS participant_type text NOT NULL DEFAULT 'company_staff';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS network_status text DEFAULT NULL;

CREATE OR REPLACE FUNCTION validate_profile_participant_type()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.participant_type NOT IN ('company_staff', 'independent_sales', 'independent_tech', 'platform_staff') THEN
    RAISE EXCEPTION 'Invalid participant_type: %', NEW.participant_type;
  END IF;
  IF NEW.network_status IS NOT NULL AND NEW.network_status NOT IN ('pending', 'approved', 'suspended', 'rejected') THEN
    RAISE EXCEPTION 'Invalid network_status: %', NEW.network_status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_profile_participant ON profiles;
CREATE TRIGGER trg_validate_profile_participant
  BEFORE INSERT OR UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION validate_profile_participant_type();
