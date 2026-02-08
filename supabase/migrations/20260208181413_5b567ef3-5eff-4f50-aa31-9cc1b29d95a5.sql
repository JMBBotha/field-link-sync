
create or replace function public.get_completed_jobs(
  p_agent_ids uuid[] default null,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null,
  p_center_lat numeric default null,
  p_center_lng numeric default null,
  p_radius_km numeric default null,
  p_search text default null
)
returns setof leads
language plpgsql
security invoker
set search_path = public
as $$
begin
  return query
  select *
  from leads
  where status = 'completed'
    and (p_agent_ids is null or assigned_agent_id = any(p_agent_ids))
    and (p_start_date is null or completed_at >= p_start_date)
    and (p_end_date is null or completed_at <= p_end_date)
    and (
      p_center_lat is null or p_center_lng is null or p_radius_km is null
      or calculate_distance_km(p_center_lat, p_center_lng, latitude, longitude) <= p_radius_km
    )
    and (p_search is null or service_type ilike '%' || p_search || '%' or customer_name ilike '%' || p_search || '%')
  order by completed_at desc;
end;
$$;
