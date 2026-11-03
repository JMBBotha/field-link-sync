CREATE SCHEMA auth; CREATE TABLE auth.me(uid uuid);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT uid FROM auth.me LIMIT 1';
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE okco(uid uuid, company_id uuid);
CREATE FUNCTION public._cf_ok(c uuid) RETURNS boolean LANGUAGE sql AS 'SELECT EXISTS(SELECT 1 FROM okco WHERE company_id=c AND uid=auth.uid())';
CREATE TABLE companies(id uuid PRIMARY KEY, name text);
CREATE TABLE suppliers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
CREATE TABLE profiles(id uuid PRIMARY KEY, full_name text, company_id uuid);
CREATE TABLE company_members(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, company_id uuid, role text, is_owner boolean DEFAULT false);
CREATE FUNCTION public.is_company_owner(u uuid, c uuid) RETURNS boolean LANGUAGE sql AS 'SELECT EXISTS(SELECT 1 FROM company_members WHERE user_id=u AND company_id=c AND is_owner)';
CREATE FUNCTION public.caller_company_id() RETURNS uuid LANGUAGE sql AS 'SELECT company_id FROM profiles WHERE id=auth.uid()';
CREATE TABLE notifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, type text, title text, body text, read boolean DEFAULT false, related_id uuid, created_at timestamptz DEFAULT now(), metadata jsonb);
-- fake data: company A (owner O, admin D, tech T), company B (admin X)
INSERT INTO companies VALUES ('aaaaaaaa-0000-0000-0000-000000000001','Demo Co A'),('bbbbbbbb-0000-0000-0000-000000000002','Demo Co B');
INSERT INTO profiles VALUES ('00000000-0000-0000-0000-00000000000a','Owner Demo','aaaaaaaa-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-00000000000d','Admin Demo','aaaaaaaa-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-00000000000e','Tech Demo','aaaaaaaa-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-00000000000f','Other Admin','bbbbbbbb-0000-0000-0000-000000000002');
INSERT INTO company_members(user_id, company_id, role, is_owner) VALUES ('00000000-0000-0000-0000-00000000000a','aaaaaaaa-0000-0000-0000-000000000001','admin',true);
INSERT INTO okco VALUES ('00000000-0000-0000-0000-00000000000d','aaaaaaaa-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-00000000000f','bbbbbbbb-0000-0000-0000-000000000002');
