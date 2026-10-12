-- 2026-10-12 16:41 SAST: approved by Johan. Applied:
--   UPDATE profiles SET onboarding_completed = true WHERE id = '1e795a9b-f8bd-4af5-8f28-5e0426101daa';
-- Cause: profiles.onboarding_completed was false (since 2026-04-01) so /onboarding wizard showed for johan@0800becool.co.za.
-- Backup: backup_johan_onboarding_20261012.profiles (1 row, onboarding_completed = false)
-- ROLLBACK:
UPDATE profiles p SET onboarding_completed = b.onboarding_completed
FROM backup_johan_onboarding_20261012.profiles b WHERE p.id = b.id;
