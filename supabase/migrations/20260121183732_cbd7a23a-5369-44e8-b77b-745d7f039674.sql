-- Add job duration tracking columns to leads table
ALTER TABLE public.leads
ADD COLUMN IF NOT EXISTS estimated_duration_minutes integer,
ADD COLUMN IF NOT EXISTS estimated_end_time timestamp with time zone,
ADD COLUMN IF NOT EXISTS actual_start_time timestamp with time zone;

-- Create availability status enum type
DO $$ BEGIN
  CREATE TYPE availability_status AS ENUM ('available', 'busy', 'offline');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add availability columns to profiles table
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS availability_status text DEFAULT 'available',
ADD COLUMN IF NOT EXISTS last_availability_update timestamp with time zone DEFAULT now();

-- Add comment for documentation
COMMENT ON COLUMN public.leads.estimated_duration_minutes IS 'Estimated job duration in minutes selected by agent';
COMMENT ON COLUMN public.leads.estimated_end_time IS 'Calculated end time based on start + duration';
COMMENT ON COLUMN public.leads.actual_start_time IS 'When agent actually started the job';
COMMENT ON COLUMN public.profiles.availability_status IS 'Agent availability: available, busy, or offline';
COMMENT ON COLUMN public.profiles.last_availability_update IS 'Timestamp of last availability status change';