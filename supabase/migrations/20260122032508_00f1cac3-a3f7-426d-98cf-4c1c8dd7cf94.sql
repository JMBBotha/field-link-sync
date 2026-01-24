-- Create job_photos table for storing uploaded job photos
CREATE TABLE public.job_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL,
  storage_path TEXT NOT NULL,
  caption TEXT,
  uploaded_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_from_offline BOOLEAN DEFAULT false
);

-- Enable RLS
ALTER TABLE public.job_photos ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Agents can upload photos for their jobs"
  ON public.job_photos FOR INSERT
  WITH CHECK (
    has_role(auth.uid(), 'field_agent'::app_role) OR 
    has_role(auth.uid(), 'admin'::app_role)
  );

CREATE POLICY "Users can view photos for jobs they have access to"
  ON public.job_photos FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.leads 
      WHERE leads.id = job_photos.lead_id 
      AND (leads.assigned_agent_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
    )
  );

CREATE POLICY "Admins can delete photos"
  ON public.job_photos FOR DELETE
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Create storage bucket for job photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('job-photos', 'job-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for job photos bucket
CREATE POLICY "Agents can upload job photos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'job-photos' AND
    (has_role(auth.uid(), 'field_agent'::app_role) OR has_role(auth.uid(), 'admin'::app_role))
  );

CREATE POLICY "Anyone can view job photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'job-photos');

CREATE POLICY "Uploaders can update their photos"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'job-photos' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Admins can delete job photos"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'job-photos' AND
    has_role(auth.uid(), 'admin'::app_role)
  );

-- Add index for faster lookups
CREATE INDEX idx_job_photos_lead_id ON public.job_photos(lead_id);
CREATE INDEX idx_job_photos_uploaded_by ON public.job_photos(uploaded_by);