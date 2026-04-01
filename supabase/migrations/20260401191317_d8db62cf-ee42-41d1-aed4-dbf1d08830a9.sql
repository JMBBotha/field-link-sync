
INSERT INTO jobs (id, company_id, title, description, address, status, priority)
VALUES ('aaaaaaaa-bbbb-cccc-dddd-eeeeeeee0001', 'd9b494c7-cdb2-4e86-b4e9-8860c3519dbd', 'E2E Test AC Repair', 'Test job for dispatch flow', '123 Test Street, Cape Town', 'scheduled', 'normal');

INSERT INTO assignments (job_id, profile_id, status, assignment_type)
VALUES ('aaaaaaaa-bbbb-cccc-dddd-eeeeeeee0001', '2f7f1dd8-1308-4efe-bb8f-6094761381c6', 'proposed', 'affiliated');
