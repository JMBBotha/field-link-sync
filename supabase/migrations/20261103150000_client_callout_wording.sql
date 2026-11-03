-- Client-facing call-out wording (Johan 3 Nov 14:54): clients only ever see 'Call-out fee: R680 excl. VAT'.
-- Client templates show only the short call-out line; the full rule stays in admin/tech notes.
-- Rollback: re-run the _booking_email definition from 20261103143000_job_type_choice.sql.
CREATE OR REPLACE FUNCTION public._booking_email(p_first text, p_kind text, p_when timestamptz, p_company text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'subject', format('Your %s is booked – %s', w.what, w.day),
    'html', format('<html><body><div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:16px;color:#1f2937"><p>Hi %s,</p><p>Your %s %s is booked for <b>%s%s</b>.</p>%s<p>Reply to this email if you need to change it.</p></div></body></html>',
      coalesce(nullif(btrim(p_first),''),'there'), coalesce(nullif(btrim(p_company),''),'0800-BE-COOL'), w.what, w.day, w.tm,
      CASE WHEN p_kind = 'service' THEN '<p style="background:#FFF4E5;border:1px solid #F5B66B;border-radius:8px;padding:10px"><b>Call-out fee:</b> R680 excl. VAT</p>' ELSE '' END))
  FROM (SELECT CASE WHEN p_kind = 'service' THEN 'technician visit' ELSE 'free sales site visit' END AS what,
               to_char(p_when AT TIME ZONE 'Africa/Johannesburg', 'FMDay FMDD FMMonth YYYY') AS day,
               CASE WHEN p_when IS NULL THEN '' ELSE ' at ' || to_char(p_when AT TIME ZONE 'Africa/Johannesburg', 'HH24:MI') END AS tm) w
$$;
REVOKE ALL ON FUNCTION public._booking_email(text, text, timestamptz, text) FROM PUBLIC, anon, authenticated;
