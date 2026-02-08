
-- =============================================
-- 1. NOTIFICATIONS TABLE
-- =============================================
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  read boolean NOT NULL DEFAULT false,
  related_id uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own notifications"
  ON public.notifications FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can update their own notifications"
  ON public.notifications FOR UPDATE
  USING (user_id = auth.uid());

CREATE POLICY "System can create notifications"
  ON public.notifications FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can delete their own notifications"
  ON public.notifications FOR DELETE
  USING (user_id = auth.uid());

-- Enable realtime for notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;

-- =============================================
-- 2. INVENTORY ITEMS TABLE
-- =============================================
CREATE TABLE public.inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sku text UNIQUE,
  category text,
  quantity_in_stock integer NOT NULL DEFAULT 0,
  min_stock_level integer NOT NULL DEFAULT 5,
  unit_cost numeric(10,2) NOT NULL DEFAULT 0,
  supplier text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view inventory"
  ON public.inventory_items FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can create inventory items"
  ON public.inventory_items FOR INSERT
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update inventory items"
  ON public.inventory_items FOR UPDATE
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete inventory items"
  ON public.inventory_items FOR DELETE
  USING (has_role(auth.uid(), 'admin'::app_role));

-- =============================================
-- 3. COMMUNICATION LOG TABLE
-- =============================================
CREATE TABLE public.communication_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('call', 'email', 'whatsapp', 'note', 'site_visit')),
  subject text,
  body text,
  agent_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.communication_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view communication logs"
  ON public.communication_log FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Agents can create communication logs"
  ON public.communication_log FOR INSERT
  WITH CHECK (agent_id = auth.uid());

CREATE POLICY "Agents can update own communication logs"
  ON public.communication_log FOR UPDATE
  USING (agent_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete communication logs"
  ON public.communication_log FOR DELETE
  USING (has_role(auth.uid(), 'admin'::app_role));

-- =============================================
-- 4. TRIGGER FUNCTIONS FOR AUTO-NOTIFICATIONS
-- =============================================

-- Notify on lead assignment
CREATE OR REPLACE FUNCTION public.notify_lead_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.assigned_agent_id IS NOT NULL AND (OLD.assigned_agent_id IS NULL OR OLD.assigned_agent_id IS DISTINCT FROM NEW.assigned_agent_id) THEN
    INSERT INTO public.notifications (user_id, type, title, body, related_id)
    VALUES (
      NEW.assigned_agent_id,
      'lead_assigned',
      'New Job Assigned',
      'You have been assigned to ' || NEW.customer_name || ' - ' || NEW.service_type,
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tr_notify_lead_assignment
  AFTER UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_lead_assignment();

-- Notify on job status change
CREATE OR REPLACE FUNCTION public.notify_job_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.assigned_agent_id IS NOT NULL THEN
    -- Notify assigned agent
    INSERT INTO public.notifications (user_id, type, title, body, related_id)
    VALUES (
      NEW.assigned_agent_id,
      'job_status_change',
      'Job Status Updated',
      NEW.customer_name || ' - Status changed to ' || REPLACE(NEW.status, '_', ' '),
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tr_notify_job_status
  AFTER UPDATE ON public.leads
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.notify_job_status_change();

-- Notify admin on invoice paid
CREATE OR REPLACE FUNCTION public.notify_invoice_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  admin_record RECORD;
BEGIN
  IF OLD.status IS DISTINCT FROM 'paid' AND NEW.status = 'paid' THEN
    FOR admin_record IN SELECT user_id FROM public.user_roles WHERE role = 'admin'
    LOOP
      INSERT INTO public.notifications (user_id, type, title, body, related_id)
      VALUES (
        admin_record.user_id,
        'invoice_paid',
        'Invoice Paid 💰',
        'Invoice ' || NEW.invoice_number || ' for R ' || NEW.grand_total::text || ' has been paid',
        NEW.id
      );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tr_notify_invoice_paid
  AFTER UPDATE ON public.invoices
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.notify_invoice_paid();

-- Notify sales engineer on quote status change
CREATE OR REPLACE FUNCTION public.notify_quote_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.notifications (user_id, type, title, body, related_id)
    VALUES (
      NEW.sales_engineer_id,
      'quote_status_change',
      'Quote ' || INITCAP(NEW.status),
      'Quote ' || NEW.quote_number || ' has been ' || NEW.status,
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tr_notify_quote_status
  AFTER UPDATE ON public.quotes
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.notify_quote_status_change();
