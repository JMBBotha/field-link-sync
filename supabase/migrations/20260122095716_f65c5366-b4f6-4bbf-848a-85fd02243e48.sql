-- Add photo_type column to job_photos table for before/after categorization
ALTER TABLE public.job_photos 
ADD COLUMN photo_type text DEFAULT 'after' CHECK (photo_type IN ('before', 'after'));

-- Add index for efficient filtering by type
CREATE INDEX idx_job_photos_lead_type ON public.job_photos (lead_id, photo_type);