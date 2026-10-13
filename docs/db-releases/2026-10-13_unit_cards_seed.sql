-- Seed: 3 Samsung models researched 13 Oct (DRAFT -> Johan approves on Admin > Unit content). Images are Samsung
-- cut-outs (transparent PNG from images.samsung.com), bundled at /product-media/seed and moved into the
-- product-media bucket on the first admin visit.
INSERT INTO public.product_media (model_key, model_code, brand, family, display_name, subtitle, image_url, image_source_url, image_status,
  product_url, support_url, source_label, bullets, specs, feature_highlight, status, notes, fetched_at) VALUES
('AR09BSHGAWK/FA','AR09BSHGAWK/FA','Samsung','AR4500','Samsung AR4500 Digital Inverter','9,000 BTU/h class wall split',
 '/product-media/seed/ar09bshgawk-fa.png','https://images.samsung.com/is/image/samsung/p6pim/za/ar09bshgawk-fa/gallery/za-wall-mount-ar09bshgawk-fa-front-white-545106213','ready',
 'https://www.samsung.com/za/support/model/AR09BSHGAWK/FA/','https://www.samsung.com/za/support/model/AR09BSHGAWK/FA/','samsung.com/za · Fourways',
 ARRAY['Digital Inverter holds your set temperature smoothly and uses less power than fixed-speed units','Cooling and heating for year-round comfort','HD Filter helps trap fine dust and allergens','Good Sleep mode and a 24-hour timer','Auto Restart after a power cut'],
 '{"cool_kw":2.5,"heat_kw":2.6,"btu":8530,"eer":3.01,"cop":3.5,"noise_in_db":"36/25","noise_out_db":47,"refrigerant":"R410A","inverter":true,"wifi":false,"warranty":"Fourways 5-yr parts"}',
 '{"icon":"inverter","title":"Digital Inverter","text":"Speeds up and slows down instead of switching on and off, so the room stays steady and power use drops."}',
 'draft','Specs from the Fourways/Samsung AR4500 spec sheet (rightair.co.za copy). Samsung ZA product page is retired; link goes to the Samsung support page. Room size not stated by Samsung (retailers say 15-18 m2), so omitted. Kloppers lists EER 3.21 for this model: that is the AR24 figure, ignored.', now()),
('AR70F12C1FW/FA','AR70F12C1FW/FA','Samsung','AR70','Samsung AR70 Bespoke AI WindFree™','12,000 BTU/h wall split',
 '/product-media/seed/ar70f12c1fw-fa.png','https://images.samsung.com/is/image/samsung/p6pim/za/ar70f12c1fw-fa/gallery/za-ar9500tar70f12caawneu-ar70f12c1fw-fa-546535078','ready',
 'https://www.samsung.com/za/air-conditioners/wall-mount/ar8500t-ar70f12caawneu-wind-free-ar70f12c1fw-fa/','https://www.samsung.com/za/support/model/AR70F12C1FW/FA/','samsung.com/za',
 ARRAY['Cool without a cold draught: air flows gently through micro-holes','AI Auto Cooling learns your routine and saves energy','4-in-1 Care and copper anti-bacterial filters, Auto Clean and Freeze Wash','Built-in Wi-Fi: control it from your phone with SmartThings'],
 '{"cool_kw":3.5,"heat_kw":3.8,"btu":11942,"eer":3.21,"cop":3.41,"noise_in_db":"38/22","noise_out_db":46,"refrigerant":"R32","inverter":true,"wifi":true}',
 '{"icon":"windfree","title":"WindFree™ cooling","text":"23,000 micro-holes spread the cool air gently, so the room stays cool without a cold draught on you."}',
 'draft','Indoor noise 38/22 dBA read from the Samsung page summary; worth a glance. Warranty not on the Samsung page.', now()),
('AR40F18C0AG/FA','AR40F18C0AG/FA','Samsung','AR40','Samsung AR40 Digital Inverter','18,000 BTU/h wall split',
 '/product-media/seed/ar40f18c0ag-fa.png','https://images.samsung.com/is/image/samsung/p6pim/za/ar40f18c0ag-fa/gallery/za-wall-mount-ar5000h-ar40f09c0ag-ar40f18c0ag-fa-550728114','ready',
 'https://www.samsung.com/za/business/air-conditioners/wall-mount/ar5000hm-wind-free-ar40f18c0ag-fa/','https://www.samsung.com/za/support/model/AR40F18C0AG/FA/','samsung.com/za',
 ARRAY['Digital Inverter keeps larger rooms steady without on/off cycling','Fast Cool, then 2-way auto swing spreads the air evenly','HD Filter and DuraFin™ Plus coil protection','Auto Restart after load-shedding'],
 '{"cool_kw":4.68,"heat_kw":4.83,"btu":15999,"eer":3.09,"cop":3.5,"noise_in_db":"51/33","noise_out_db":57,"refrigerant":"R32","inverter":true,"wifi":false}',
 '{"icon":"fast","title":"Fast Cool","text":"Runs flat out to cool the room quickly, then eases back to hold your temperature quietly."}',
 'draft','Specs from the Samsung ZA business page. Indoor 51/33 dBA is the Samsung figure (high/low).', now())
ON CONFLICT (model_key) DO NOTHING;
