INSERT INTO okco VALUES ('00000000-0000-0000-0000-0000000000c1');
INSERT INTO auth.me VALUES ('00000000-0000-0000-0000-0000000000a1');
INSERT INTO supplier_products(id,product_code,description,cost_price,product_type,name) VALUES
 ('00000000-0000-0000-0000-000000000f01'::text::uuid,'FCMI-24','Test 24K',10434.09,'ac_unit','Test 24K');
INSERT INTO supplier_products(id,product_code,description,cost_price,product_type,name) VALUES ('00000000-0000-0000-0000-000000000f02','G005','GAS R410 11.3KG',2260,'consumable','GAS R410 11.3KG');
INSERT INTO quotes VALUES ('00000000-0000-0000-0000-0000000000e1'::text::uuid,'Q-TEST-1','Test Client A');
INSERT INTO quote_items(id,quote_id,product_id,item_name,quantity) VALUES ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-000000000f01','FCMI-24',1),
 ('00000000-0000-0000-0000-0000000000d2','00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-000000000f02','Gas',1);
INSERT INTO jobs VALUES ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000e1','Test job A');
INSERT INTO supplier_job_documents VALUES ('00000000-0000-0000-0000-00000000dd01','00000000-0000-0000-0000-0000000000c1','delivery_note','DN-1','Test Supplier','PO1'),
 ('00000000-0000-0000-0000-00000000dd02','00000000-0000-0000-0000-0000000000c1','supplier_invoice','INV-1','Test Supplier','PO1');
INSERT INTO supplier_job_document_lines(id,document_id,company_id,line_no,description,model_number,qty) VALUES
 ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000dd01','00000000-0000-0000-0000-0000000000c1',1,'Indoor','FCMI-24-P',1),
 ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-00000000dd02','00000000-0000-0000-0000-0000000000c1',1,'Indoor','FCMI-24-P',1),
 ('00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-00000000dd02','00000000-0000-0000-0000-0000000000c1',2,'Gas','G005',2);
SELECT sjd_receive('00000000-0000-0000-0000-00000000dd01','[{"line_id":"00000000-0000-0000-0000-0000000000a1","action":"reserve","job_id":"00000000-0000-0000-0000-0000000000b1","product_id":"00000000-0000-0000-0000-000000000f01","model_code":"FCMI24","qty_packs":1,"unit_cost_pack":10434.09,"cost_source":"catalogue"}]') AS dn;
SELECT sjd_receive('00000000-0000-0000-0000-00000000dd02','[{"line_id":"00000000-0000-0000-0000-0000000000a2","action":"reserve","job_id":"00000000-0000-0000-0000-0000000000b1","product_id":"00000000-0000-0000-0000-000000000f01","model_code":"FCMI24","qty_packs":1,"unit_cost_pack":11000,"cost_source":"invoice","price_flag":"warn","price_note":"higher"},{"line_id":"00000000-0000-0000-0000-0000000000a3","action":"stock","product_id":"00000000-0000-0000-0000-000000000f02","model_code":"G005","item":"R410a","stock_unit":"kg","pack_size":11.3,"qty_packs":2,"unit_cost_pack":2260,"cost_source":"invoice"}]') AS inv;
SELECT sjd_receive('00000000-0000-0000-0000-00000000dd02','[{"line_id":"00000000-0000-0000-0000-0000000000a3","action":"stock","pack_size":11.3,"qty_packs":2}]') AS again;
SELECT item, model_code, qty_on_hand, unit_cost_excl, stock_unit, pack_size FROM cf_stock_items ORDER BY item;
SELECT source_key, job_id IS NOT NULL has_job, qty, status FROM cf_commitments;
SELECT count(*) allocations FROM cf_stock_allocations;
SELECT job_materials_plan('00000000-0000-0000-0000-0000000000b1') AS plan;
SELECT job_materials_draw('00000000-0000-0000-0000-0000000000b1', (SELECT jsonb_build_array(jsonb_build_object('stock_item_id',id,'qty',30)) FROM cf_stock_items WHERE model_code='G005')) AS draw;
SELECT item, qty_on_hand FROM cf_stock_items ORDER BY item;
DELETE FROM auth.me;
INSERT INTO auth.me VALUES ('00000000-0000-0000-0000-0000000000ff');
DELETE FROM okco;
SELECT job_materials_plan('00000000-0000-0000-0000-0000000000b1') IS NOT NULL AS stranger_should_fail;
SELECT sjd_receive('00000000-0000-0000-0000-00000000dd01','[]') AS nonadmin_should_fail;
INSERT INTO assignments(job_id,profile_id) VALUES ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000ff');
SELECT (job_materials_plan('00000000-0000-0000-0000-0000000000b1')->'items') IS NOT NULL AS assigned_tech_ok;
SELECT sjd_receive('00000000-0000-0000-0000-00000000dd01','[]') AS tech_receive_should_fail
