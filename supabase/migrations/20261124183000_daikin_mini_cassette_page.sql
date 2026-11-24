-- Daikin April 2026 book. Not applied live.
-- 46 mini-cassette multi rows (FFA) were stored on page 8. That image is the
-- ceiling-suspended (FHA) page. The codes are on PDF page 6 (printed "8"),
-- in this same order. page_number moves to 6. row_bbox.y moves onto the
-- printed row (PDF text line minus 0.01, the same box-top gap as the Livance
-- radios). x, width, height, prices, markup and sell_price stay as they are.
-- Idempotent: a second run sets the same page and the same y.

UPDATE public.supplier_products AS sp
SET page_number = 6,
    row_bbox = jsonb_set(sp.row_bbox, '{y}', to_jsonb(v.y), true)
FROM (VALUES
  ('264b26e2-55ca-4054-ae1e-1048f41e119d'::uuid, 0.1026),
  ('8b4f5a68-9bed-4725-bdbd-f394212b271c'::uuid, 0.1198),
  ('d54c8d9e-a274-4fab-b1b7-5cae2546ff81'::uuid, 0.137),
  ('8adf4f64-b402-485e-8eab-0d4744c27301'::uuid, 0.1543),
  ('297d674b-7641-4493-af53-040ae9d5f72d'::uuid, 0.1715),
  ('b29172c9-fc62-4031-8990-9e7c3c0911dc'::uuid, 0.1887),
  ('3275d1f2-8469-4d59-afd9-4a1e0b3e0398'::uuid, 0.2059),
  ('dd3c0ccf-8422-4197-8d3e-32e69f5e048a'::uuid, 0.2232),
  ('0eb32c2c-7b7d-464d-8e26-bf13cdb3398d'::uuid, 0.2404),
  ('28e23982-a082-4b57-9403-7832cd19470c'::uuid, 0.2576),
  ('ea1a38c0-2e0c-4258-ac9c-d1feec300d31'::uuid, 0.2748),
  ('3f0e6ffc-e33a-4fe2-95b1-ee9f1e44c3b3'::uuid, 0.2921),
  ('033908a8-c8c7-494a-85c4-5b7b01ddbc26'::uuid, 0.3093),
  ('f4dfe9d2-0493-449a-a55f-3c62e5c96d7f'::uuid, 0.3265),
  ('7a7e159c-846c-40ed-95b6-5d23d083ce0c'::uuid, 0.3438),
  ('e8609bf2-4843-40fb-95cf-de21929ad304'::uuid, 0.3729),
  ('40f0dc85-5f2a-4371-adac-fa0d14f7da7e'::uuid, 0.3901),
  ('3c0d6d2c-2281-4efb-9665-49f8356ab763'::uuid, 0.4073),
  ('b45be4eb-0c36-43ad-9ef5-7dde37b68ccc'::uuid, 0.4245),
  ('45db326b-44a4-4251-84ff-a3c92aa84775'::uuid, 0.4418),
  ('5db5a08d-b280-49ba-aae1-e7be1cfc5955'::uuid, 0.459),
  ('41224150-794c-4f6a-81b7-632aedf82794'::uuid, 0.4762),
  ('4cf61a04-e7f1-4975-a03b-5e5ce03b4d92'::uuid, 0.4935),
  ('e24919a9-fdcd-406f-9dc2-77b6f1290d7a'::uuid, 0.5107),
  ('391ca14c-b5db-45ff-b139-af654fc746b8'::uuid, 0.5279),
  ('9108e9db-4b64-4e42-91c0-133e0ffacb96'::uuid, 0.5451),
  ('08ebf101-b1f1-45e1-92c8-fc36d4aa50c3'::uuid, 0.5624),
  ('0377e379-b943-40c9-b897-f6ecd50e9d0d'::uuid, 0.5796),
  ('be557a5a-58a2-4ee0-bf17-7141cdfabf5b'::uuid, 0.5968),
  ('ea461c17-bbc7-4509-b39f-854c5a172bd4'::uuid, 0.6141),
  ('f5755a46-918f-4dca-9c29-3caed108dc43'::uuid, 0.6313),
  ('de854848-ea20-4094-af55-f3b4fa62389d'::uuid, 0.6485),
  ('0f9c098c-b232-4793-9058-0e0e38fb5e74'::uuid, 0.6776),
  ('cc1690c2-db94-4c8c-8145-26ff7b4bb179'::uuid, 0.7067),
  ('64fcb164-8658-4022-923b-cee5512b754a'::uuid, 0.724),
  ('be7b0783-f470-4c64-a9f1-f0e24e45d929'::uuid, 0.7531),
  ('4c90528b-e3b2-45db-a34f-e5462eb2bbbf'::uuid, 0.7703),
  ('3df3642e-b55a-4f09-87ac-c5d1c371ae9b'::uuid, 0.7875),
  ('5a1aa8ab-d7a5-4025-ac53-350e315c3cf3'::uuid, 0.8047),
  ('73d2280b-9404-4d72-947b-38f48a4961b5'::uuid, 0.822),
  ('37702a80-5661-4057-b1d1-032b18878984'::uuid, 0.8392),
  ('9b5aed8e-2493-4100-93b4-6954faff1675'::uuid, 0.8683),
  ('0f8e65e0-a3e1-48be-863b-ea8d2a2ceb0b'::uuid, 0.8855),
  ('4425740a-db9f-49b3-b818-297d451e2fb5'::uuid, 0.9028),
  ('a81d28c7-cad5-4b54-9204-bc35f2b02f7e'::uuid, 0.92),
  ('959a638c-cda9-433f-b7a3-9698809f77fa'::uuid, 0.9372)
) AS v(id, y)
WHERE sp.id = v.id
  AND sp.pdf_upload_id = '8121252a-a48d-42f9-9b15-b00e0e41027d'
  AND sp.row_bbox IS NOT NULL
  AND (
    sp.page_number IS DISTINCT FROM 6
    OR (sp.row_bbox->>'y')::numeric IS DISTINCT FROM v.y
  );
