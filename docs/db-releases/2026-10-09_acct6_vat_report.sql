-- acct6: VAT report lines. Output VAT = invoices - credit notes; input VAT = expenses. Rate by document date
-- (vat_rate_for: 14% before 2018-04-01, else 15%); documents without VAT stay at 0. Office + viewer roles; own company.
CREATE OR REPLACE FUNCTION public.vat_report_lines(p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_co uuid := public.caller_company_id(); r jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.is_field_tech_only(auth.uid()) OR public.is_sales_rep(auth.uid())
     OR NOT (public.is_ops_user(auth.uid()) OR public.has_role(auth.uid(), 'viewer'::app_role)) OR v_co IS NULL THEN
    RAISE EXCEPTION 'Only office staff can see the VAT report' USING ERRCODE = '42501'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 3700 THEN RAISE EXCEPTION 'Choose a valid date range'; END IF;
  WITH docs AS (
    SELECT 'invoice'::text kind, COALESCE(i.issue_date, i.created_at::date) d, i.invoice_number ref, i.customer_name party,
           COALESCE(i.grand_total, 0) incl, COALESCE(i.tax_amount, 0) stored_vat,
           CASE WHEN COALESCE(i.tax_amount, 0) > 0 THEN public.vat_rate_for(COALESCE(i.issue_date, i.created_at::date)) ELSE 0 END rate
      FROM public.invoices i
     WHERE i.company_id = v_co AND COALESCE(i.status, 'draft') NOT IN ('draft', 'void', 'cancelled')
    UNION ALL
    SELECT 'credit_note', cn.issue_date, cn.credit_note_number, i.customer_name, -cn.total, -cn.tax_amount,
           CASE WHEN cn.tax_amount > 0 THEN public.vat_rate_for(COALESCE(i.issue_date, i.created_at::date)) ELSE 0 END
      FROM public.credit_notes cn JOIN public.invoices i ON i.id = cn.invoice_id
     WHERE cn.company_id = v_co AND cn.status = 'issued'
    UNION ALL
    SELECT 'expense', e.expense_date, e.reference, COALESCE(e.supplier_name, e.category), e.amount_incl, e.vat_amount, e.vat_rate
      FROM public.expenses e
     WHERE e.company_id = v_co AND e.status = 'active'
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', kind, 'date', d, 'ref', ref, 'party', party, 'incl', ROUND(incl, 2),
           'rate', rate, 'vat', ROUND(incl * rate / (100 + rate), 2), 'stored_vat', ROUND(stored_vat, 2)) ORDER BY d, kind, ref), '[]'::jsonb)
    INTO r FROM docs WHERE d BETWEEN p_from AND p_to;
  RETURN r;
END $f$;
REVOKE ALL ON FUNCTION public.vat_report_lines(date, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.vat_report_lines(date, date) TO authenticated;
