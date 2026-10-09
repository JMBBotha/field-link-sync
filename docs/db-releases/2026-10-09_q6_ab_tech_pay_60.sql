-- Q6 (2026-10-09): AB technician labour pay 60% (was 50% = 40 paid on completion + 10 holdback).
-- Config only (AB TEST setup; 0 tech ledger rows exist). Applied as Johan via the app's own admin function.
begin; set local role authenticated;
select set_config('request.jwt.claims','{"sub":"420c7731-e8a4-4355-80ca-51c684b42a2c","role":"authenticated"}',true);
select public.set_company_tech_pay_settings('d9b494c7-cdb2-4e86-b4e9-8860c3519dbd', 50, 10, 45, 10);
commit;
