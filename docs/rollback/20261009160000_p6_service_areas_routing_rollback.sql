-- P6 rollback
DROP FUNCTION IF EXISTS public.area_slot_suggestions(uuid, date, integer);
DROP FUNCTION IF EXISTS public.route_lead_to_company(uuid, boolean);
DROP FUNCTION IF EXISTS public._p6_km(numeric, numeric, numeric, numeric);
DROP TABLE IF EXISTS public.lead_routing_log;
DROP TABLE IF EXISTS public.service_area_staff;
DROP FUNCTION IF EXISTS public.p6_area_ok(uuid, boolean);
DROP TABLE IF EXISTS public.service_areas;
