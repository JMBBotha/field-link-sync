-- Add scheduled_time column to leads table for precise scheduling
ALTER TABLE public.leads 
ADD COLUMN scheduled_time time without time zone DEFAULT NULL;