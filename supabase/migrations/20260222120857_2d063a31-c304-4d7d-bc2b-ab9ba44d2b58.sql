-- Add recurrence JSONB column to fb_invoices for recurring invoice support
ALTER TABLE public.fb_invoices ADD COLUMN IF NOT EXISTS recurrence jsonb DEFAULT NULL;

-- Add archived status support (check constraint already allows it via no constraint, 
-- but let's ensure the cancelled status list is broader)
-- fb_invoices already has a check constraint for status, let's update it
-- First check what constraints exist
DO $$
BEGIN
  -- Drop existing check constraint if it exists
  IF EXISTS (SELECT 1 FROM information_schema.constraint_column_usage 
             WHERE table_name = 'fb_invoices' AND column_name = 'status') THEN
    ALTER TABLE public.fb_invoices DROP CONSTRAINT IF EXISTS fb_invoices_status_check;
  END IF;
END $$;

-- Re-add with archived status included
ALTER TABLE public.fb_invoices ADD CONSTRAINT fb_invoices_status_check 
  CHECK (status IN ('draft', 'sent', 'viewed', 'paid', 'overdue', 'cancelled', 'archived', 'partial'));

-- Add archived status to fb_estimates  
DO $$
BEGIN
  ALTER TABLE public.fb_estimates DROP CONSTRAINT IF EXISTS fb_estimates_status_check;
END $$;

ALTER TABLE public.fb_estimates ADD CONSTRAINT fb_estimates_status_check
  CHECK (status IN ('draft', 'sent', 'viewed', 'accepted', 'declined', 'archived'));