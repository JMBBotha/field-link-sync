DO $$
DECLARE
  v_cust uuid := 'c786e758-8372-472c-ad19-5925dc274bdc';
  v_phones text[] := ARRAY['+27696838624','0696838624','27696838624','696838624'];
  v_leads uuid[];
BEGIN
  SELECT array_agg(id) INTO v_leads FROM public.leads
   WHERE customer_id = v_cust OR customer_phone = ANY(v_phones);
  v_leads := COALESCE(v_leads, ARRAY[]::uuid[]);

  DELETE FROM public.vapi_calls WHERE customer_id = v_cust OR caller_phone = ANY(v_phones) OR lead_id = ANY(v_leads);
  DELETE FROM public.job_expenses WHERE lead_id = ANY(v_leads);
  DELETE FROM public.job_time_entries WHERE lead_id = ANY(v_leads);
  DELETE FROM public.assignments WHERE job_id IN (SELECT id FROM public.jobs WHERE customer_id = v_cust OR lead_id = ANY(v_leads));
  DELETE FROM public.job_activity_log WHERE job_id IN (SELECT id FROM public.jobs WHERE customer_id = v_cust OR lead_id = ANY(v_leads));
  DELETE FROM public.jobs WHERE customer_id = v_cust OR lead_id = ANY(v_leads);
  DELETE FROM public.notifications WHERE related_id = ANY(v_leads);
  DELETE FROM public.leads WHERE id = ANY(v_leads);
END $$;