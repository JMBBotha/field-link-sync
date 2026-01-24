-- Create notification_settings table
CREATE TABLE public.notification_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  setting_key TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  channels TEXT[] NOT NULL DEFAULT ARRAY['email']::TEXT[],
  template_subject TEXT,
  template_body TEXT NOT NULL,
  variables TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create notification_queue table
CREATE TABLE public.notification_queue (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  notification_type TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  recipient_email TEXT,
  recipient_phone TEXT,
  subject TEXT,
  body TEXT NOT NULL,
  variables JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL DEFAULT 'pending',
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  sent_at TIMESTAMP WITH TIME ZONE,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create customer_tokens table for portal access
CREATE TABLE public.customer_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  token UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  expires_at TIMESTAMP WITH TIME ZONE,
  last_accessed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create notification_logs table for audit trail
CREATE TABLE public.notification_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  notification_queue_id UUID REFERENCES public.notification_queue(id) ON DELETE SET NULL,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT,
  error_message TEXT,
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Add notification preferences to customers table
ALTER TABLE public.customers
ADD COLUMN IF NOT EXISTS preferred_contact_method TEXT DEFAULT 'email',
ADD COLUMN IF NOT EXISTS notification_opt_in BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false;

-- Enable RLS on new tables
ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for notification_settings (admin only)
CREATE POLICY "Admins can view notification settings"
ON public.notification_settings FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can create notification settings"
ON public.notification_settings FOR INSERT
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update notification settings"
ON public.notification_settings FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete notification settings"
ON public.notification_settings FOR DELETE
USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS Policies for notification_queue (admin only)
CREATE POLICY "Admins can view notification queue"
ON public.notification_queue FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can manage notification queue"
ON public.notification_queue FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS Policies for customer_tokens (public read for portal access, admin manage)
CREATE POLICY "Anyone can verify tokens"
ON public.customer_tokens FOR SELECT
USING (true);

CREATE POLICY "Admins can manage customer tokens"
ON public.customer_tokens FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS Policies for notification_logs (admin only)
CREATE POLICY "Admins can view notification logs"
ON public.notification_logs FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "System can create notification logs"
ON public.notification_logs FOR INSERT
WITH CHECK (true);

-- Insert default notification templates
INSERT INTO public.notification_settings (setting_key, enabled, channels, template_subject, template_body, variables) VALUES
('job_assigned', true, ARRAY['email'], 'Your {job_type} appointment is confirmed!', 'Hi {customer_name},

Your {job_type} appointment has been confirmed! 

Technician {tech_name} will arrive on {scheduled_date}.

If you have any questions, please don''t hesitate to contact us.

Best regards,
Be Cool HVAC Team', ARRAY['customer_name', 'job_type', 'tech_name', 'scheduled_date']),

('tech_en_route', true, ARRAY['email', 'sms'], '{tech_name} is on the way!', 'Good news, {customer_name}!

{tech_name} is on the way to your location for your {job_type} appointment.

Estimated arrival: {eta}
Contact technician: {tech_phone}

See you soon!', ARRAY['customer_name', 'tech_name', 'job_type', 'eta', 'tech_phone']),

('tech_arrived', true, ARRAY['email'], 'Your technician has arrived', 'Hi {customer_name},

{tech_name} has arrived and is starting work on your {job_type}.

We''ll notify you when the work is complete.

Thank you for choosing Be Cool!', ARRAY['customer_name', 'tech_name', 'job_type']),

('job_completed', true, ARRAY['email'], 'Work completed! ✓', 'Hi {customer_name},

Great news! Your {job_type} has been completed successfully.

Technician: {tech_name}
Date: {completion_date}

Your invoice will be sent shortly.

Thank you for your business!', ARRAY['customer_name', 'job_type', 'tech_name', 'completion_date']),

('invoice_sent', true, ARRAY['email'], 'Invoice #{invoice_number} from Be Cool HVAC', 'Hi {customer_name},

Please find your invoice attached.

Invoice Number: #{invoice_number}
Amount Due: R{amount}
Service: {job_type}

View and pay online: {invoice_link}

Thank you for choosing Be Cool!', ARRAY['customer_name', 'invoice_number', 'amount', 'job_type', 'invoice_link']),

('payment_received', true, ARRAY['email'], 'Payment confirmed! 🎉', 'Hi {customer_name},

We''ve received your payment of R{amount} for Invoice #{invoice_number}.

Thank you for your prompt payment!

Best regards,
Be Cool HVAC Team', ARRAY['customer_name', 'amount', 'invoice_number']),

('feedback_request', true, ARRAY['email'], 'How was your service?', 'Hi {customer_name},

We hope you''re enjoying your {job_type} service!

We''d love to hear your feedback. It only takes a minute:
{feedback_link}

Your opinion helps us improve and serve you better.

Thank you!
Be Cool HVAC Team', ARRAY['customer_name', 'job_type', 'feedback_link']);

-- Create function to generate or get customer token
CREATE OR REPLACE FUNCTION public.get_or_create_customer_token(p_customer_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token UUID;
BEGIN
  -- Try to get existing valid token
  SELECT token INTO v_token
  FROM public.customer_tokens
  WHERE customer_id = p_customer_id
    AND (expires_at IS NULL OR expires_at > now())
  ORDER BY created_at DESC
  LIMIT 1;
  
  -- If no valid token, create new one
  IF v_token IS NULL THEN
    INSERT INTO public.customer_tokens (customer_id, expires_at)
    VALUES (p_customer_id, now() + interval '90 days')
    RETURNING token INTO v_token;
  END IF;
  
  RETURN v_token;
END;
$$;

-- Create function to validate customer token and get customer_id
CREATE OR REPLACE FUNCTION public.validate_customer_token(p_token UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id UUID;
BEGIN
  SELECT customer_id INTO v_customer_id
  FROM public.customer_tokens
  WHERE token = p_token
    AND (expires_at IS NULL OR expires_at > now());
  
  IF v_customer_id IS NOT NULL THEN
    -- Update last accessed
    UPDATE public.customer_tokens
    SET last_accessed_at = now()
    WHERE token = p_token;
  END IF;
  
  RETURN v_customer_id;
END;
$$;

-- Create index for faster token lookups
CREATE INDEX idx_customer_tokens_token ON public.customer_tokens(token);
CREATE INDEX idx_notification_queue_status ON public.notification_queue(status, scheduled_at);
CREATE INDEX idx_notification_queue_customer ON public.notification_queue(customer_id);