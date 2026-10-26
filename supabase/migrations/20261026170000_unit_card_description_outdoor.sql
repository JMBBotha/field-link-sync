-- Step 3 (preview, unapplied): short client-facing description + paired outdoor unit for quote unit cards.
-- Text is taken only from Samsung's own product pages (africa_en AC9000 Wind-Free 4Way); no invented claims.
-- Outdoor model numbers are from the same Samsung spec tables. No real Samsung outdoor photo found yet -> outdoor_image_url stays NULL ("Photo to follow").
alter table public.product_media add column if not exists description text;
alter table public.product_media add column if not exists outdoor_model_code text;
alter table public.product_media add column if not exists outdoor_image_url text;
update public.product_media set description = $d$Samsung WindFree™ 4-way ceiling cassette (heat pump) that keeps the room comfortably cool without the feel of direct cold wind: air is gently dispersed through 15,672 micro air holes. Big blades widen the cooling range, and a Motion Detect Sensor adjusts the airflow. Paired with the Samsung AC100JX4DEH/AF outdoor unit (single-phase).$d$, outdoor_model_code = 'AC100JX4DEH/AF' where model_key = 'AC100NN4DEH/AF';
update public.product_media set description = $d$Samsung WindFree™ 4-way ceiling cassette (heat pump) that keeps the room comfortably cool without the feel of direct cold wind: air is gently dispersed through 15,672 micro air holes. Big blades widen the cooling range, and a Motion Detect Sensor adjusts the airflow. Paired with the Samsung AC140JX4DGH/AF outdoor unit (three-phase).$d$, outdoor_model_code = 'AC140JX4DGH/AF' where model_key = 'AC140NN4DEH/AF';
-- Rollback: alter table public.product_media drop column if exists description, drop column if exists outdoor_model_code, drop column if exists outdoor_image_url;
