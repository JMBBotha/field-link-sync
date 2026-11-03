-- Rollback for 20261103130000_company_tools.sql. Run manually ONLY if the register must be removed (drops all tool data).
DO $$ BEGIN IF to_regclass('storage.objects') IS NOT NULL THEN EXECUTE 'DROP POLICY IF EXISTS tool_invoices_admin_rw ON storage.objects'; END IF; END $$;
-- The tool-invoices bucket is left in place (empty it in the dashboard first if it must go).
DROP VIEW IF EXISTS public.tool_type_stats;
DROP FUNCTION IF EXISTS public.report_tool_issue(uuid, public.tool_status, text);
DROP FUNCTION IF EXISTS public.set_tool_status(uuid, public.tool_status, text);
DROP FUNCTION IF EXISTS public.return_tool(uuid, text);
DROP FUNCTION IF EXISTS public.issue_tool(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.update_tool(uuid, jsonb);
DROP FUNCTION IF EXISTS public.add_tool_type(uuid, text);
DROP FUNCTION IF EXISTS public.add_tools(uuid, uuid, text, text[], text, date, integer, boolean, text, uuid);
DROP FUNCTION IF EXISTS public._tool_notify_lost(public.tools, text);
DROP FUNCTION IF EXISTS public._tool_log(public.tools, public.tool_event_kind, public.tool_status, text);
DROP FUNCTION IF EXISTS public._tool_me();
DROP TABLE IF EXISTS public.tool_events;   -- trigger goes with the table
DROP TABLE IF EXISTS public.tools;
DROP TABLE IF EXISTS public.tool_types;
DROP FUNCTION IF EXISTS public._tools_admin(uuid);
DROP FUNCTION IF EXISTS public._tools_no_delete();
DROP FUNCTION IF EXISTS public._tool_events_append_only();
DROP TYPE IF EXISTS public.tool_event_kind;
DROP TYPE IF EXISTS public.tool_status;
DELETE FROM public.notifications WHERE type = 'tool_lost';
