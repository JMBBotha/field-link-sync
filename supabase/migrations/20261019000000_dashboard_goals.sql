-- R4 dashboard number row: owner-set goals/limits (null = sensible app defaults). Additive; existing RLS (admins update own company) applies.
alter table public.company_settings add column if not exists dashboard_goals jsonb;
comment on column public.company_settings.dashboard_goals is 'R4 KPI goals/limits {depositLimit, followupLimit, revenueGoal, jobsGoal, visitsGoal}; null = app defaults';
