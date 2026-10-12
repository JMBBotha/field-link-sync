DO $t$
DECLARE r jsonb; s uuid := (SELECT supplier_id FROM pdf_uploads WHERE id='7a70bb10-a3db-4a8f-989d-b231eddeac46'); n uuid;
BEGIN
  r := jsonb_build_object('uploads', (SELECT jsonb_agg(left(id::text,8)||':'||status||':'||is_active ORDER BY created_at) FROM pdf_uploads),
    'active_per_supplier_max', (SELECT max(c) FROM (SELECT count(*) c FROM pdf_uploads WHERE is_active GROUP BY supplier_id) x),
    'live_products_on_inactive_upload', (SELECT count(*) FROM supplier_products p JOIN pdf_uploads u ON u.id=p.pdf_upload_id WHERE p.is_active AND NOT coalesce(p.archived,false) AND NOT u.is_active));
  INSERT INTO pdf_uploads(supplier_id, file_name, status, is_active) VALUES (s,'TEST new list','parsed',true) RETURNING id INTO n;
  r := r || jsonb_build_object('after_new', (SELECT jsonb_build_object('sept',(SELECT status||is_active FROM pdf_uploads WHERE id='7a70bb10-a3db-4a8f-989d-b231eddeac46'),'new',(SELECT status||is_active FROM pdf_uploads WHERE id=n))));
  RAISE EXCEPTION 'RESULT %', r;
END $t$;
