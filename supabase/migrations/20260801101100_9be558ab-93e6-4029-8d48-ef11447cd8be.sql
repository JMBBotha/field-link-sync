
-- Normalise existing values to canonical snake_case
UPDATE public.customers SET lead_source = lower(replace(trim(lead_source), ' ', '_'))
WHERE lead_source IS NOT NULL;

UPDATE public.customers SET lead_source = 'walk_in' WHERE lead_source = 'walk-in';

ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS customers_lead_source_check;

-- Anything still unrecognised becomes 'other' so the new constraint can be applied safely
UPDATE public.customers SET lead_source = 'other'
WHERE lead_source IS NOT NULL
  AND lead_source NOT IN (
    'manual','referral','website','website_form','social_media','facebook_lead','instagram',
    'whatsapp','phone_call','cold_call','email_campaign','trade_show','walk_in','vapi',
    'quote_picker','csv_import','api','other'
  );

ALTER TABLE public.customers
  ADD CONSTRAINT customers_lead_source_check
  CHECK (
    lead_source IS NULL OR lead_source IN (
      'manual','referral','website','website_form','social_media','facebook_lead','instagram',
      'whatsapp','phone_call','cold_call','email_campaign','trade_show','walk_in','vapi',
      'quote_picker','csv_import','api','other'
    )
  );
