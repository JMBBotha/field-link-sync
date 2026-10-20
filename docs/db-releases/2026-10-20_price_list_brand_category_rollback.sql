-- Rollback for 20261020095500_price_list_brand_category.sql (applied 20 Oct 2026 SAST).
-- Restores brand = NULL on exactly the rows the backfill touched, then drops category.
UPDATE public.pdf_uploads SET brand = NULL
WHERE id IN ('8121252a-a48d-42f9-9b15-b00e0e41027d','c9daafca-eecf-40f6-acc3-bc4d3fdcdd37');
UPDATE public.supplier_pdf_pages SET brand = NULL WHERE id IN (
'383f1901-e791-4c46-bc2b-32ea73f29a86','4aa9109a-a0bb-4d01-98a5-ac15d69060c0','4d5b9175-b2d6-43f1-b427-81fe91ed5eb5',
'f713e065-9411-4688-b395-1bf81d5f495e','e181bbd2-27c5-4389-a1b4-3309c7d1d418','098070a4-f198-4e72-97ad-b6443fab3f58',
'6ee8ff29-d9ad-4ef6-8fd0-5e94dc0a2307','eefd0f2c-2084-418f-9741-1066f8a4822d','3b64a9d8-2d1a-4c70-a12b-0cbbc6509fd2',
'2a5fded3-bc7f-4d57-b1fd-66ba024376cf','feddf06a-3066-43a6-9083-4964dd4e4a90','11ea2db0-cb38-4831-88c8-37e36b43a65d',
'4bfb7643-1b7c-4f95-a265-d4feba33177c');
ALTER TABLE public.pdf_uploads DROP CONSTRAINT IF EXISTS pdf_uploads_category_check;
ALTER TABLE public.pdf_uploads DROP COLUMN IF EXISTS category;
-- Code: git revert <release sha> (front-end only). Revert code BEFORE dropping the column,
-- or the upload screen insert (category) will fail.
