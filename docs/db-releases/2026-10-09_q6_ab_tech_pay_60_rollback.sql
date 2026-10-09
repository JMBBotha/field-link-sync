-- Rollback Q6: back to 40 paid + 10 holdback (45 days) + 10 tools = tech 50%
begin; set local role authenticated;
select set_config('request.jwt.claims','{"sub":"420c7731-e8a4-4355-80ca-51c684b42a2c","role":"authenticated"}',true);
select public.set_company_tech_pay_settings('d9b494c7-cdb2-4e86-b4e9-8860c3519dbd', 40, 10, 45, 10);
commit;
