-- Rollback for 20261026150000_unit_photos_samsung.sql: back to draft, no photo (cards show "Photo to follow").
UPDATE public.product_media SET image_path=NULL, image_url=NULL, image_source_url=NULL, image_status='none', image_licence_note=NULL,
  status='draft', approved_at=NULL, updated_at=now()
WHERE model_key IN ('AC100NN4DEH/AF','AC140NN4DEH/AF','AJ035TNNDKH/EA','AJ026TNNDKH/EA','AJ026TN1DKH/EA','AJ035TN1DKH/EA','AJ068TXJ3KH/EA','AJ080TXJ4KH/EA','AJ100TXJ5KH/EA','AJ125TXJ5KH/EA','AC100RN4DKG/EU','AJ071TNLPKH/EA');
DELETE FROM public.product_media WHERE model_key IN ('AC100NN4DEH/AF','AC140NN4DEH/AF') AND notes LIKE 'Photo step 1 26 Oct 2026%';
-- Optional: ALTER TABLE public.product_media DROP COLUMN image_licence_note;
-- Files: delete product-media/samsung/* in Storage (or leave; unused).
