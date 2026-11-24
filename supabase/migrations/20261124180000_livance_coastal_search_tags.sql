-- Livance June book (pdf_uploads f8bcf8fe-9ccd-45f0-a57d-6f14a1e42ec8). Not applied live.
-- Coastal kits are one combined product_code (indoor + CST outdoor + fascia).
-- The row text does not contain "lcac" or "coastal", so quote search missed them.
-- Append those words and each '+'-separated part code to search_tags.
-- Prices, markup, sell_price, category and page geometry are not changed.
-- The two MICAS-48 rows without a fascia box stay Under Ceiling: the PDF row
-- text on page 3 says UNDER CEILING, not cassette.
-- Idempotent: tags are a deduped set, so a second run does not add them again.
-- Touches every non-archived row on this book whose code contains CST-R32-MICOND
-- (19 rows on the June PDF: 8 cassette, 6 duct, 5 under ceiling).

UPDATE public.supplier_products AS sp
SET search_tags = (
  SELECT string_agg(tag, ' ' ORDER BY tag)
  FROM (
    SELECT DISTINCT tag
    FROM (
      SELECT unnest(regexp_split_to_array(
        lower(regexp_replace(coalesce(sp.search_tags, ''), '\s+', ' ', 'g')),
        ' '
      )) AS tag
      UNION ALL
      SELECT 'lcac'
      UNION ALL
      SELECT 'coastal'
      UNION ALL
      SELECT lower(trim(regexp_replace(part, '\(x\s*\d+\)', '', 'gi')))
      FROM regexp_split_to_table(sp.product_code, '\s*\+\s*') AS part
    ) words
    WHERE tag IS NOT NULL AND length(tag) >= 2
  ) deduped
)
WHERE sp.pdf_upload_id = 'f8bcf8fe-9ccd-45f0-a57d-6f14a1e42ec8'
  AND sp.product_code ILIKE '%CST-R32-MICOND%'
  AND coalesce(sp.archived, false) = false;
