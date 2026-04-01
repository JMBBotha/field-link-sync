
UPDATE profiles SET network_status = 'approved', onboarding_completed = true WHERE id = '2f7f1dd8-1308-4efe-bb8f-6094761381c6';

INSERT INTO agent_affiliations (profile_id, company_id, affiliation_type, status)
VALUES ('2f7f1dd8-1308-4efe-bb8f-6094761381c6', 'd9b494c7-cdb2-4e86-b4e9-8860c3519dbd', 'technical', 'active')
ON CONFLICT DO NOTHING;
