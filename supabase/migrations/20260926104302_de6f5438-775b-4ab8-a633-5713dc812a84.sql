CREATE OR REPLACE FUNCTION public.get_customer_portal_data(p_token uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cid uuid;
BEGIN
  SELECT customer_id INTO v_cid FROM public.customer_tokens
   WHERE token = p_token AND (expires_at IS NULL OR expires_at > now());
  IF v_cid IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'customer', (SELECT jsonb_build_object('id', c.id, 'name', c.name, 'email', c.email, 'phone', c.phone, 'address', c.address)
                   FROM public.customers c WHERE c.id = v_cid),
    'jobs', COALESCE((SELECT jsonb_agg(j ORDER BY j.created_at DESC) FROM (
              SELECT l.id, l.service_type, l.status, l.lead_status, l.created_at, l.completed_at, l.scheduled_date,
                     l.customer_address, l.assigned_agent_id, p.full_name AS agent_name
                FROM public.leads l LEFT JOIN public.profiles p ON p.id = l.assigned_agent_id
               WHERE l.customer_id = v_cid AND l.deleted_at IS NULL
               ORDER BY l.created_at DESC LIMIT 20) j), '[]'::jsonb),
    'invoices', COALESCE((SELECT jsonb_agg(i ORDER BY i.created_at DESC) FROM (
              SELECT inv.id, inv.invoice_number, inv.lead_id, inv.status, inv.grand_total, inv.due_date, inv.created_at,
                     public.invoice_amount_paid(inv.id) AS amount_paid, q.public_token AS quote_token
                FROM public.invoices inv LEFT JOIN public.quotes q ON q.id = inv.quote_id
               WHERE inv.customer_id = v_cid AND inv.status NOT IN ('cancelled','void')) i), '[]'::jsonb),
    'payments', COALESCE((SELECT jsonb_agg(pm ORDER BY pm.payment_date DESC) FROM (
              SELECT py.id, py.amount, py.payment_date, py.method, py.status, inv.invoice_number
                FROM public.payments py JOIN public.invoices inv ON inv.id = py.invoice_id
               WHERE inv.customer_id = v_cid AND py.status IN ('paid','succeeded','completed')) pm), '[]'::jsonb)
  );
END $$;
REVOKE ALL ON FUNCTION public.get_customer_portal_data(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_portal_data(uuid) TO anon, authenticated;