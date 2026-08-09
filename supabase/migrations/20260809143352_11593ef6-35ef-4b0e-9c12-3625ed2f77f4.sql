CREATE OR REPLACE FUNCTION public.log_entity_resolution(
  p_entity_type text,
  p_query       text,
  p_decision    text,
  p_chosen_id   uuid DEFAULT NULL,
  p_chosen_label text DEFAULT NULL,
  p_score       real DEFAULT NULL,
  p_candidates  jsonb DEFAULT '[]'::jsonb,
  p_channel     text DEFAULT 'text'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  INSERT INTO public.nl_audit_log (
    user_id, company_id, tool_name, args, result, status,
    resource_type, resource_id, access_granted
  ) VALUES (
    auth.uid(),
    public.get_user_company_id(auth.uid()),
    'resolve_entity',
    jsonb_build_object('entity_type', p_entity_type, 'query', p_query, 'channel', p_channel),
    jsonb_build_object(
      'decision', p_decision,
      'chosen_id', p_chosen_id,
      'chosen_label', p_chosen_label,
      'score', p_score,
      'candidates', coalesce(p_candidates, '[]'::jsonb)
    ),
    p_decision,
    p_entity_type,
    p_chosen_id,
    p_chosen_id IS NOT NULL
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_entity_resolution(text, text, text, uuid, text, real, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_entity_resolution(text, text, text, uuid, text, real, jsonb, text) TO authenticated, service_role;