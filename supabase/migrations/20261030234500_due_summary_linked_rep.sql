CREATE OR REPLACE FUNCTION public.invoice_due_summary()
 RETURNS TABLE(invoice_id uuid, invoice_number text, customer_id uuid, customer_name text, customer_email text, amount_due numeric, due date, days integer, step text, rep_id uuid, followup_id uuid, followup_status text, followup_step text, followup_subject text, followup_message text, terms_basis text, terms_days integer, waiting boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_co uuid := public.get_user_company_id(auth.uid()); v_rep boolean := public.is_sales_rep(auth.uid());
  v_today date := (now() at time zone 'Africa/Johannesburg')::date;
begin
  if auth.uid() is null or v_co is null or public.is_field_tech_only(auth.uid())
     or not (public.has_role(auth.uid(),'admin'::app_role) or public.has_role(auth.uid(),'dispatcher'::app_role) or v_rep) then return; end if;
  return query
  select x.id, x.invoice_number, x.customer_id, x.customer_name, x.customer_email, x.amt, x.dd, v_today - x.dd,
    case when x.dd is null then null else public._inv_step(x.company_id, v_today - x.dd) end, x.rep,
    f.id, f.status, f.step, f.subject, coalesce(f.approved_message, f.proposed_message), (x.t).basis, (x.t).days, x.dd is null
  from (select i.*, public._pf_amount_due(i.id) amt, public._inv_due_eff(i.id) dd, public._inv_rep(i.id) rep, public._inv_terms(i.id) t
        from public.invoices i
        where i.company_id = v_co and coalesce(i.notes,'') not like 'DEPOSIT%' and coalesce(i.deposit_type,'') <> 'deposit_invoice'
          and lower(coalesce(i.status,'')) not in ('paid','draft','cancelled','void','archived')
          and public._pf_invoice_sent(i.sent_at, i.sent_method, i.status)) x
  left join lateral (select * from public.payment_followups pf where pf.invoice_id = x.id and pf.status in ('pending','approved') and x.dd is not null order by pf.created_at desc limit 1) f on true
  where x.amt > 0 and (not v_rep or x.rep = auth.uid() or public.rep_can_see_invoice(auth.uid(), x.id));
end $function$;
