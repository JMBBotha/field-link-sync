create or replace function public._client_contact_fill_invoice() returns trigger language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if new.customer_id is null then return new; end if;
  select coalesce(nullif(trim(coalesce(first_name,'') || ' ' || coalesce(last_name,'')), ''), name) as nm, email, phone,
         coalesce(nullif(concat_ws(', ', nullif(primary_address_line1,''), nullif(primary_address_line2,''), nullif(city,''), nullif(postal_code,'')), ''), address) as addr
    into c from public.customers where id = new.customer_id;
  if not found then return new; end if;
  new.customer_name := coalesce(nullif(c.nm,''), new.customer_name);
  new.customer_email := coalesce(nullif(c.email,''), new.customer_email);
  new.customer_phone := coalesce(nullif(c.phone,''), new.customer_phone);
  new.customer_address := coalesce(nullif(c.addr,''), new.customer_address);
  return new;
end $$;
revoke all on function public._client_contact_fill_invoice() from public, anon, authenticated;
drop trigger if exists trg_client_contact_fill_invoice on public.invoices;
create trigger trg_client_contact_fill_invoice before insert or update of customer_id on public.invoices
  for each row execute function public._client_contact_fill_invoice();

create or replace function public._client_contact_push() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.invoices set customer_id = customer_id
   where customer_id = new.id and coalesce(status,'') not in ('paid','void','cancelled');
  return new;
end $$;
revoke all on function public._client_contact_push() from public, anon, authenticated;
drop trigger if exists trg_client_contact_push on public.customers;
create trigger trg_client_contact_push after update of name, first_name, last_name, email, phone, address, primary_address_line1, primary_address_line2, city, postal_code on public.customers
  for each row execute function public._client_contact_push();