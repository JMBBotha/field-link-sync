-- Public client invoice view: read via token (anon RLS blocked direct reads -> "No invoices yet").
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
           public.invoice_amount_paid(i.id) as amount_paid
      from invoices i
     where (i.customer_id = v_cid or i.lead_id in (select l.id from leads l where l.customer_id = v_cid))
       and coalesce(i.status,'') not in ('void','cancelled','draft')) x), '[]'::jsonb);
end $$;
grant execute on function public.get_customer_invoices_public(uuid) to anon, authenticated;

-- Fallback for bare /<uuid> links: map a client token, quote token or invoice id to its public page.
create or replace function public.resolve_public_link(p_id uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v text; v_inv invoices;
begin
  if exists (select 1 from customer_tokens where token = p_id and (expires_at is null or expires_at > now())) then
    return '/customer/' || p_id || '/invoices';
  end if;
  select public_token::text into v from quotes where public_token::text = p_id::text limit 1;
  if v is not null then return '/quote/' || v; end if;
  select * into v_inv from invoices where id = p_id and coalesce(status,'') not in ('void','cancelled','draft');
  if v_inv.id is not null then
    select token::text into v from customer_tokens where customer_id = v_inv.customer_id and (expires_at is null or expires_at > now()) order by created_at desc limit 1;
    if v is not null then return '/customer/' || v || '/invoice/' || v_inv.id; end if;
    select q.public_token::text into v from quotes q where q.id = v_inv.quote_id;
    if v is not null then return '/quote/' || v; end if;
  end if;
  return null;
end $$;
grant execute on function public.resolve_public_link(uuid) to anon, authenticated;
