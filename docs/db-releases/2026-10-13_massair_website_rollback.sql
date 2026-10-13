-- Rollback: restore before value (NULL).
UPDATE public.company_profiles SET website = NULL, updated_at = now()
 WHERE id = '8ebd6434-3fca-5a8d-8476-270e994dcb46' AND company_id = '361bf031-9cdb-4d7f-9bde-9eb95fa4725e';
