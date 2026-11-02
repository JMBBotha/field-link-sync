-- Invoice stamps on the client view (Johan 2 Nov): add sent_at and settled payment dates/amounts to the
-- token-scoped public read. Only date + amount per payment (no references, methods or notes).
create or replace function public.get_customer_invoices_public(p_token uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cid uuid;
begin
  select customer_id into v_cid from customer_tokens where token = p_token and (expires_at is null or expires_at > now());
  if v_cid is null then return null; end if;
  return coalesce((select jsonb_agg(x order by x.created_at desc) from (
    select i.id, i.invoice_number, i.customer_name, i.customer_address, i.line_items, i.subtotal, i.tax_rate, i.tax_amount,
           i.grand_total, i.payment_method, i.notes, i.status, i.paid_date, i.created_at, i.issue_date, i.due_date,
           i.billed_to_vat_number, i.company_id, i.company_profile_id, i.deposit_type, i.deposit_amount, i.quote_id,
           public.invoice_amount_paid(i.id) as amount_paid,
           i.sent_at,
           coalesce((select jsonb_agg(jsonb_build_object('amount', p.amount, 'payment_date', p.payment_date, 'created_at', p.created_at, 'status', p.status, 'gateway', p.gateway) order by p.payment_date, p.created_at)
                       from payments p where p.invoice_id = i.id
                        and (p.status in ('paid','succeeded','completed') or (p.status is null and p.gateway = 'manual'))), '[]'::jsonb) as stamp_payments
      from invoices i
     where (i.customer_id = v_cid or i.lead_id in (select l.id from leads l where l.customer_id = v_cid))
       and coalesce(i.status,'') not in ('void','cancelled','draft')) x), '[]'::jsonb);
end $$;
grant execute on function public.get_customer_invoices_public(uuid) to anon, authenticated;
