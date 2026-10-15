CREATE OR REPLACE FUNCTION public.qcr_style(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p ~* 'multi|\mMSP\M|outdoor only|indoor only' THEN 'multi'
    WHEN p ~* 'cassette' THEN 'cassette' WHEN p ~* 'duct' THEN 'ducted'
    WHEN p ~* 'under ?ceiling|ceiling' THEN 'ceiling' WHEN p ~* 'floor' THEN 'floor'
    WHEN p ~* 'portable' THEN 'portable' WHEN p ~* 'window' THEN 'window' ELSE 'wall' END $$;