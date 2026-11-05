// Ledger checks for 20261105140000_stock_three_buckets.sql on PGlite. Dummy company only.
// node supabase/tests/stock_buckets/run.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mig = path.join(here, "../../migrations");
const db = new PGlite();
const fail = (m) => { console.error("FAIL", m); process.exitCode = 1; };
const q = async (sql) => (await db.query(sql)).rows;
const one = async (sql) => (await q(sql))[0];

await db.exec(fs.readFileSync(path.join(here, "../stock_receive/stub.sql"), "utf8"));
await db.exec(`
  CREATE TABLE companies(id uuid PRIMARY KEY);
  INSERT INTO companies VALUES ('00000000-0000-0000-0000-0000000000c1');
  ALTER TABLE jobs ADD COLUMN status text;
  ALTER TABLE jobs ADD COLUMN job_type text;
`);
const ch = fs.readFileSync(path.join(mig, "20261019110000_cash_health.sql"), "utf8");
await db.exec(ch.slice(ch.indexOf("CREATE OR REPLACE FUNCTION public.cf_allocate_stock"), ch.indexOf("CREATE OR REPLACE FUNCTION public.cf_unallocate_stock")));
await db.exec(fs.readFileSync(path.join(mig, "20261102210000_stock_receive.sql"), "utf8"));
await db.exec(fs.readFileSync(path.join(mig, "20261103080000_stock_pair_reserve_cost.sql"), "utf8"));
await db.exec(fs.readFileSync(path.join(mig, "20261105140000_stock_three_buckets.sql"), "utf8"));
await db.exec(fs.readFileSync(path.join(mig, "20261105150000_stock_doc_match.sql"), "utf8"));
await db.exec(fs.readFileSync(path.join(mig, "20261105160000_stock_asof_returns.sql"), "utf8"));

const co = "00000000-0000-0000-0000-0000000000c1";
const job = "00000000-0000-0000-0000-0000000000b1";
const prod = "00000000-0000-0000-0000-000000000f01";
const gas = "00000000-0000-0000-0000-000000000f02";

await db.exec(`
INSERT INTO auth.me VALUES ('00000000-0000-0000-0000-0000000000a1');
INSERT INTO okco VALUES ('${co}');
INSERT INTO supplier_products(id,product_code,description,cost_price,product_type,name) VALUES
 ('${prod}','FCMI-24','Test 24K',10434.09,'ac_unit','Test 24K'),
 ('${gas}','G005','GAS R410 11.3KG',2260,'consumable','GAS R410 11.3KG');
INSERT INTO quotes VALUES ('00000000-0000-0000-0000-0000000000e1','Q-TEST-1','Test quote');
INSERT INTO quote_items(id,quote_id,product_id,item_name,quantity) VALUES
 ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000e1','${prod}','FCMI-24',1);
INSERT INTO jobs(id,company_id,quote_id,title,status,job_type) VALUES
 ('${job}','${co}','00000000-0000-0000-0000-0000000000e1','Test job A','scheduled','install'),
 ('00000000-0000-0000-0000-0000000000b2','${co}',NULL,'Test job B','scheduled','install');
INSERT INTO supplier_job_documents(id,company_id,doc_type,doc_number,supplier_name,po_number) VALUES
 ('00000000-0000-0000-0000-00000000dd01','${co}','delivery_note','DN-1','Test Supplier','PO1'),
 ('00000000-0000-0000-0000-00000000dd02','${co}','supplier_invoice','INV-1','Test Supplier','PO1'),
 ('00000000-0000-0000-0000-00000000dd04','${co}','supplier_invoice','INV-G','Test Supplier','PO9');
INSERT INTO supplier_job_document_lines(id,document_id,company_id,line_no,description,model_number,qty) VALUES
 ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-00000000dd01','${co}',1,'Indoor','FCMI-24-P',1),
 ('00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-00000000dd02','${co}',1,'Indoor','FCMI-24-P',1),
 ('00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-00000000dd02','${co}',2,'Gas','G005',2),
 ('00000000-0000-0000-0000-0000000000a6','00000000-0000-0000-0000-00000000dd04','${co}',1,'Indoor','FCMI-24-P',1);
`);

const dn = await one(`SELECT sjd_receive('00000000-0000-0000-0000-00000000dd01','[{"line_id":"00000000-0000-0000-0000-0000000000a1","action":"reserve","job_id":"${job}","product_id":"${prod}","model_code":"FCMI24","qty_packs":1,"unit_cost_pack":10434.09,"cost_source":"catalogue","bucket":"job_unit","half":"indoor"}]') AS r`);
if (Number(dn.r.reserved) !== 1 || Number(dn.r.stocked) !== 1) fail("delivery note should post quantity and reserve once, got " + JSON.stringify(dn));
const movesAfterDn = await one(`SELECT count(*)::int n FROM stock_movements`);
if (movesAfterDn.n !== 1) fail("delivery note must post the quantity, got " + movesAfterDn.n);

const inv = await one(`SELECT sjd_receive('00000000-0000-0000-0000-00000000dd02','[
  {"line_id":"00000000-0000-0000-0000-0000000000a2","action":"reserve","job_id":"${job}","product_id":"${prod}","model_code":"FCMI24","item":"Test 24K","qty_packs":1,"unit_cost_pack":11000,"cost_source":"invoice","bucket":"job_unit","half":"indoor","vat_rate":15},
  {"line_id":"00000000-0000-0000-0000-0000000000a3","action":"stock","product_id":"${gas}","model_code":"G005","item":"R410a","stock_unit":"kg","pack_size":11.3,"qty_packs":2,"unit_cost_pack":2260,"cost_source":"invoice","bucket":"material_pool","vat_rate":15,"delivered":true}
]') AS r`);
if (Number(inv.r.cost_only) !== 1) fail("invoice matching the delivery note must not post quantity again " + JSON.stringify(inv));
if (Number(inv.r.reserved) !== 0) fail("invoice must not reserve again " + JSON.stringify(inv));
const reserves = await one(`SELECT count(*)::int n FROM cf_commitments WHERE job_id='${job}'`);
if (reserves.n !== 1) fail("job should have one reservation, got " + reserves.n);

const buckets = await q(`SELECT bucket, kind, qty, unit_cost_excl FROM stock_movements ORDER BY bucket, kind`);
const jobRecv = buckets.filter((b) => b.bucket === "job_unit" && b.kind === "receive");
const pool = buckets.filter((b) => b.bucket === "material_pool" && b.kind === "receive");
if (jobRecv.length !== 1 || Number(jobRecv[0].qty) !== 1 || Number(jobRecv[0].unit_cost_excl) !== 10434.09) fail("job unit quantity stays the delivery receipt " + JSON.stringify(jobRecv));
if (pool.length !== 1 || Number(pool[0].qty) !== 22.6) fail("gas must land in the materials pool " + JSON.stringify(pool));
const allocOnJobUnit = await one(`SELECT count(*)::int n FROM stock_movements WHERE unit_id IN (SELECT id FROM stock_units WHERE origin='job_received') AND kind='allocate'`);
if (allocOnJobUnit.n !== 0) fail("job-received unit must not also be allocated");

const vat = await one(`SELECT vat_amount FROM supplier_job_document_lines WHERE id='00000000-0000-0000-0000-0000000000a3'`);
if (Number(vat.vat_amount) !== 678) fail("gas VAT should be 678, got " + vat.vat_amount);

const again = await one(`SELECT sjd_receive('00000000-0000-0000-0000-00000000dd02','[{"line_id":"00000000-0000-0000-0000-0000000000a3","action":"stock","pack_size":11.3,"qty_packs":2}]') AS r`);
if (Number(again.r.already_received) < 1) fail("second confirm must be idempotent");
const moveCount = await one(`SELECT count(*)::int n FROM stock_movements`);
if (moveCount.n !== 3) fail("idempotent confirm must not add movements, have " + moveCount.n);

let blocked = false;
try {
  const unit = await one(`SELECT id FROM stock_units WHERE origin='job_received' LIMIT 1`);
  await db.query(`SELECT stock_assign_unit('${unit.id}','00000000-0000-0000-0000-0000000000b2')`);
} catch (e) { blocked = /cannot also be moved/.test(e.message); }
if (!blocked) fail("assigning a job-received unit must fail");

await db.exec(`SELECT sjd_receive('00000000-0000-0000-0000-00000000dd04','[{"line_id":"00000000-0000-0000-0000-0000000000a6","action":"stock","product_id":"${prod}","model_code":"FCMI24","item":"Test 24K","qty_packs":1,"unit_cost_pack":9000,"cost_source":"invoice","bucket":"general_unit","half":"indoor","delivered":true}]')`);
const gen = await one(`SELECT id FROM stock_units WHERE origin='general_stock' LIMIT 1`);
await db.query(`SELECT stock_assign_unit('${gen.id}','00000000-0000-0000-0000-0000000000b2')`);
const legs = await q(`SELECT bucket, qty FROM stock_movements WHERE unit_id='${gen.id}' AND kind='allocate' ORDER BY qty`);
if (legs.length !== 2 || Number(legs[0].qty) !== -1 || Number(legs[1].qty) !== 1) fail("assign must be a general -1 and job +1 " + JSON.stringify(legs));
if (Number(legs[0].qty) + Number(legs[1].qty) !== 0) fail("assign must not change total qty");

await db.exec(`INSERT INTO material_allowances (company_id, job_type, unit_size, product_id, item_label, stock_unit, qty, effective_from, active)
 VALUES ('${co}','install','24000','${gas}','R410a','kg',0.5,CURRENT_DATE,true)`);
const posted = await one(`SELECT job_apply_material_allowances('${job}') AS r`);
if (Number(posted.r.posted) !== 1) fail("allowance should post once " + JSON.stringify(posted));
const posted2 = await one(`SELECT job_apply_material_allowances('${job}') AS r`);
if (Number(posted2.r.already) !== 1 || Number(posted2.r.posted) !== 0) fail("allowance must be idempotent " + JSON.stringify(posted2));
const use = await one(`SELECT qty, unit_cost_excl FROM stock_movements WHERE kind='use' AND job_id='${job}'`);
if (Number(use.qty) !== -0.5 || Number(use.unit_cost_excl) !== 200) fail("use must be -0.5 kg at average 200 " + JSON.stringify(use));

const tech = await one(`SELECT job_units_for_tech('${job}')::text AS t`);
if (/unit_cost|vat_amount/.test(tech.t)) fail("tech payload leaked cost " + tech.t);
if (!tech.t.includes("FCMI24")) fail("tech should see the unit code");

const value = await q(`SELECT bucket, qty, value_excl FROM stock_value_as_of('${co}', now()) ORDER BY bucket`);
const poolVal = value.find((v) => v.bucket === "material_pool");
if (!poolVal || Number(poolVal.qty) !== 22.1) fail("pool qty after allowance " + JSON.stringify(value));

const cost = await one(`SELECT unit_cost_excl, material_cost_excl FROM job_stock_cost WHERE job_id='${job}'`);
if (Number(cost.unit_cost_excl) !== 11000 || Number(cost.material_cost_excl) !== 100) fail("job cost " + JSON.stringify(cost));

const gasItem = await one(`SELECT id FROM cf_stock_items WHERE model_code='G005'`);
const countId = await one(`SELECT stock_count_save('${co}', CURRENT_DATE, '[{"stock_item_id":"${gasItem.id}","bucket":"material_pool","counted_qty":20,"reason":"Monthly count short"}]') AS id`);
const post = await one(`SELECT stock_count_post('${countId.id}') AS r`);
if (Number(post.r.posted) !== 1) fail("count should post one adjust " + JSON.stringify(post));
const post2 = await one(`SELECT stock_count_post('${countId.id}') AS r`);
if (post2.r.already !== true) fail("second post must not write another adjust");
const countAdjusts = await one(`SELECT count(*)::int n FROM stock_movements WHERE kind='adjust' AND count_line_id IS NOT NULL`);
if (countAdjusts.n !== 1) fail("monthly count should post one adjust, got " + countAdjusts.n);
let frozen = false;
try { await db.query(`UPDATE stock_movements SET qty = 0 WHERE kind='adjust'`); } catch (e) { frozen = /append-only/.test(e.message); }
if (!frozen) fail("movements must reject updates");

// Delivered first, invoiced second: quantity once, cost moves to the invoice price.
await db.exec(`
INSERT INTO supplier_products(id,product_code,name,cost_price,product_type) VALUES ('00000000-0000-0000-0000-000000000f03','COPPER-TEST','Copper test',10,'consumable');
INSERT INTO supplier_job_documents(id,company_id,doc_type,doc_number,supplier_name,po_number) VALUES
 ('00000000-0000-0000-0000-00000000dd10','${co}','delivery_note','DN-C','Test Supplier','PO-C'),
 ('00000000-0000-0000-0000-00000000dd11','${co}','supplier_invoice','INV-C','Test Supplier','PO-C'),
 ('00000000-0000-0000-0000-00000000dd12','${co}','supplier_invoice','INV-C2','Test Supplier','PO-C'),
 ('00000000-0000-0000-0000-00000000dd13','${co}','credit_note','CN-C','Test Supplier','PO-C');
INSERT INTO supplier_job_document_lines(id,document_id,company_id,line_no,description,model_number,qty) VALUES
 ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-00000000dd10','${co}',1,'Copper','COPPER-TEST',4),
 ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-00000000dd11','${co}',1,'Copper','COPPER-TEST',4),
 ('00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-00000000dd12','${co}',1,'Copper','COPPER-TEST',4),
 ('00000000-0000-0000-0000-0000000000c4','00000000-0000-0000-0000-00000000dd13','${co}',1,'Copper','COPPER-TEST',1);
`);
await db.exec(`SELECT sjd_receive('00000000-0000-0000-0000-00000000dd10','[{"line_id":"00000000-0000-0000-0000-0000000000c1","action":"stock","product_id":"00000000-0000-0000-0000-000000000f03","model_code":"COPPERTEST","item":"Copper","qty_packs":4,"unit_cost_pack":10,"bucket":"material_pool"}]')`);
const afterDnC = await one(`SELECT coalesce(sum(qty),0) AS q FROM stock_movements m JOIN cf_stock_items s ON s.id=m.stock_item_id WHERE s.model_code='COPPERTEST' AND public.stock_qty_counts(m.kind,m.supplier_document_id,m.supplier_document_line_id)`);
if (Number(afterDnC.q) !== 4) fail("delivery before invoice should be in the count, got " + afterDnC.q);
const invC = await one(`SELECT sjd_receive('00000000-0000-0000-0000-00000000dd11','[{"line_id":"00000000-0000-0000-0000-0000000000c2","action":"stock","product_id":"00000000-0000-0000-0000-000000000f03","model_code":"COPPERTEST","item":"Copper","qty_packs":4,"unit_cost_pack":12,"bucket":"material_pool"}]') AS r`);
if (Number(invC.r.cost_only) !== 1 || Number(invC.r.stocked) !== 0) fail("second document must be cost only " + JSON.stringify(invC));
const afterInvC = await one(`SELECT coalesce(sum(qty),0) AS q FROM stock_movements m JOIN cf_stock_items s ON s.id=m.stock_item_id WHERE s.model_code='COPPERTEST' AND public.stock_qty_counts(m.kind,m.supplier_document_id,m.supplier_document_line_id)`);
if (Number(afterInvC.q) !== 4) fail("invoice must not add copper quantity, got " + afterInvC.q);
const avgC = await one(`SELECT material_avg_cost(id, now()) AS a FROM cf_stock_items WHERE model_code='COPPERTEST'`);
if (Number(avgC.a) !== 12) fail("average should move to the invoice price, got " + avgC.a);
const invC2 = await one(`SELECT sjd_receive('00000000-0000-0000-0000-00000000dd12','[{"line_id":"00000000-0000-0000-0000-0000000000c3","action":"stock","product_id":"00000000-0000-0000-0000-000000000f03","model_code":"COPPERTEST","qty_packs":4,"unit_cost_pack":15}]') AS r`);
if (Number(invC2.r.stocked) !== 0) fail("a second invoice must not post quantity " + JSON.stringify(invC2));
const cn = await one(`SELECT sjd_receive('00000000-0000-0000-0000-00000000dd13','[{"line_id":"00000000-0000-0000-0000-0000000000c4","action":"stock","product_id":"00000000-0000-0000-0000-000000000f03","model_code":"COPPERTEST","qty_packs":1,"unit_cost_pack":12}]') AS r`);
if (Number(cn.r.returned) !== 1) fail("credit note should reverse " + JSON.stringify(cn));
const afterCn = await one(`SELECT coalesce(sum(m.qty),0) AS q FROM stock_movements m JOIN cf_stock_items s ON s.id=m.stock_item_id WHERE s.model_code='COPPERTEST' AND public.stock_qty_counts(m.kind,m.supplier_document_id,m.supplier_document_line_id)`);
if (Number(afterCn.q) !== 3) fail("credit should leave 3, got " + JSON.stringify(afterCn));

// Invoiced before delivery stays out of the count, then the delivery note releases the same quantity.
await db.exec(`
INSERT INTO supplier_products(id,product_code,name,cost_price,product_type) VALUES ('00000000-0000-0000-0000-000000000f04','PIPE-TEST','Pipe test',8,'consumable');
INSERT INTO supplier_job_documents(id,company_id,doc_type,doc_number,po_number) VALUES
 ('00000000-0000-0000-0000-00000000dd20','${co}','supplier_invoice','INV-P','PO-P'),
 ('00000000-0000-0000-0000-00000000dd21','${co}','delivery_note','DN-P','PO-P');
INSERT INTO supplier_job_document_lines(id,document_id,company_id,line_no,model_number,qty) VALUES
 ('00000000-0000-0000-0000-0000000000e1','00000000-0000-0000-0000-00000000dd20','${co}',1,'PIPE-TEST',5),
 ('00000000-0000-0000-0000-0000000000e2','00000000-0000-0000-0000-00000000dd21','${co}',1,'PIPE-TEST',5);
`);
await db.exec(`SELECT sjd_receive('00000000-0000-0000-0000-00000000dd20','[{"line_id":"00000000-0000-0000-0000-0000000000e1","action":"stock","product_id":"00000000-0000-0000-0000-000000000f04","model_code":"PIPETEST","qty_packs":5,"unit_cost_pack":8}]')`);
const awaiting = await one(`SELECT coalesce(sum(qty),0) AS on_hand FROM stock_movements m JOIN cf_stock_items s ON s.id=m.stock_item_id WHERE s.model_code='PIPETEST' AND public.stock_qty_counts(m.kind,m.supplier_document_id,m.supplier_document_line_id)`);
const waiting = await one(`SELECT coalesce(sum(qty),0) AS q FROM stock_movements m JOIN cf_stock_items s ON s.id=m.stock_item_id WHERE s.model_code='PIPETEST' AND NOT public.stock_qty_counts(m.kind,m.supplier_document_id,m.supplier_document_line_id)`);
if (Number(awaiting.on_hand) !== 0 || Number(waiting.q) !== 5) fail("invoice before delivery must be awaiting, not on hand " + JSON.stringify({ awaiting, waiting }));
await db.exec(`SELECT sjd_receive('00000000-0000-0000-0000-00000000dd21','[{"line_id":"00000000-0000-0000-0000-0000000000e2","action":"stock","product_id":"00000000-0000-0000-0000-000000000f04","model_code":"PIPETEST","qty_packs":5,"unit_cost_pack":8}]')`);
const released = await one(`SELECT coalesce(sum(qty),0) AS q, count(*) FILTER (WHERE kind='receive')::int AS receives FROM stock_movements m JOIN cf_stock_items s ON s.id=m.stock_item_id WHERE s.model_code='PIPETEST' AND public.stock_qty_counts(m.kind,m.supplier_document_id,m.supplier_document_line_id)`);
if (Number(released.q) !== 5 || Number(released.receives) !== 1) fail("delivery must release the same quantity once " + JSON.stringify(released));

const sized = await one(`SELECT stock_unit_size_key('12M') AS m, stock_unit_size_key('24K') AS k, stock_unit_size_key('FCMI-24') AS u, stock_unit_size_key('12KG') AS kg, stock_unit_size_key('FCMI-124') AS long`);
if (sized.m !== null || sized.kg !== null || sized.long !== null || sized.k !== "24000" || sized.u !== "24000") fail("size key " + JSON.stringify(sized));
await db.exec(`
INSERT INTO supplier_job_documents(id,company_id,doc_type,doc_number) VALUES ('00000000-0000-0000-0000-00000000dd30','${co}','delivery_note','DN-NC');
INSERT INTO supplier_job_document_lines(id,document_id,company_id,line_no,model_number,qty) VALUES ('00000000-0000-0000-0000-0000000000f1','00000000-0000-0000-0000-00000000dd30','${co}',1,'NOCOST-1',1);
`);
await db.exec(`SELECT sjd_receive('00000000-0000-0000-0000-00000000dd30','[{"line_id":"00000000-0000-0000-0000-0000000000f1","action":"stock","model_code":"NOCOST1","item":"No cost","qty_packs":1,"bucket":"material_pool"}]')`);
const noCost = await one(`SELECT m.unit_cost_excl IS NULL AS missing, l.cost_missing FROM stock_movements m JOIN supplier_job_document_lines l ON l.id=m.supplier_document_line_id WHERE l.id='00000000-0000-0000-0000-0000000000f1'`);
if (!noCost?.missing || noCost.cost_missing !== true) fail("missing cost must stay null " + JSON.stringify(noCost));

// As-of value stays awaiting until the delivery note's own timestamp.
await db.exec(`
INSERT INTO supplier_products(id,product_code,name,cost_price,product_type) VALUES ('00000000-0000-0000-0000-000000000f05','WIDGET-TEST','Widget',20,'consumable');
INSERT INTO supplier_job_documents(id,company_id,doc_type,doc_number,po_number) VALUES
 ('00000000-0000-0000-0000-00000000dd40','${co}','supplier_invoice','INV-W','PO-W'),
 ('00000000-0000-0000-0000-00000000dd41','${co}','delivery_note','DN-W','PO-W');
INSERT INTO supplier_job_document_lines(id,document_id,company_id,line_no,model_number,qty) VALUES
 ('00000000-0000-0000-0000-0000000000aa','00000000-0000-0000-0000-00000000dd40','${co}',1,'WIDGET-TEST',3),
 ('00000000-0000-0000-0000-0000000000ab','00000000-0000-0000-0000-00000000dd41','${co}',1,'WIDGET-TEST',3);
`);
await db.exec(`SELECT sjd_receive('00000000-0000-0000-0000-00000000dd40','[{"line_id":"00000000-0000-0000-0000-0000000000aa","action":"stock","product_id":"00000000-0000-0000-0000-000000000f05","model_code":"WIDGETTEST","qty_packs":3,"unit_cost_pack":20}]')`);
await db.exec(`SELECT sjd_receive('00000000-0000-0000-0000-00000000dd41','[{"line_id":"00000000-0000-0000-0000-0000000000ab","action":"stock","product_id":"00000000-0000-0000-0000-000000000f05","model_code":"WIDGETTEST","qty_packs":3,"unit_cost_pack":20}]')`);
await db.exec(`UPDATE supplier_job_document_lines SET received_at = clock_timestamp() + interval '2 hours' WHERE id='00000000-0000-0000-0000-0000000000ab'`);
const histW = await one(`SELECT coalesce(sum(m.qty),0) AS q FROM stock_movements m JOIN cf_stock_items s ON s.id=m.stock_item_id WHERE s.model_code='WIDGETTEST' AND public.stock_qty_counts(m.kind,m.supplier_document_id,m.supplier_document_line_id, clock_timestamp())`);
const laterW = await one(`SELECT coalesce(sum(m.qty),0) AS q FROM stock_movements m JOIN cf_stock_items s ON s.id=m.stock_item_id WHERE s.model_code='WIDGETTEST' AND public.stock_qty_counts(m.kind,m.supplier_document_id,m.supplier_document_line_id, clock_timestamp() + interval '3 hours')`);
if (Number(histW.q) !== 0 || Number(laterW.q) !== 3) fail("as-of must stay awaiting until the delivery note timestamp " + JSON.stringify({ histW, laterW }));

// Invoice variance is on the unit, and booking the unit out removes it from stock value.
await db.exec(`
INSERT INTO supplier_products(id,product_code,name,cost_price,product_type) VALUES ('00000000-0000-0000-0000-000000000f06','UNIT-VAR','Unit var',100,'ac_unit');
INSERT INTO jobs(id,company_id,title,status,job_type) VALUES ('00000000-0000-0000-0000-0000000000b3','${co}','Variance job','scheduled','install');
INSERT INTO supplier_job_documents(id,company_id,doc_type,doc_number,po_number) VALUES
 ('00000000-0000-0000-0000-00000000dd50','${co}','delivery_note','DN-V','PO-V'),
 ('00000000-0000-0000-0000-00000000dd51','${co}','supplier_invoice','INV-V','PO-V');
INSERT INTO supplier_job_document_lines(id,document_id,company_id,line_no,model_number,qty) VALUES
 ('00000000-0000-0000-0000-0000000000ba','00000000-0000-0000-0000-00000000dd50','${co}',1,'UNIT-VAR',1),
 ('00000000-0000-0000-0000-0000000000bb','00000000-0000-0000-0000-00000000dd51','${co}',1,'UNIT-VAR',1);
`);
await db.exec(`SELECT sjd_receive('00000000-0000-0000-0000-00000000dd50','[{"line_id":"00000000-0000-0000-0000-0000000000ba","action":"reserve","job_id":"00000000-0000-0000-0000-0000000000b3","product_id":"00000000-0000-0000-0000-000000000f06","model_code":"UNITVAR","qty_packs":1,"unit_cost_pack":100,"bucket":"job_unit"}]')`);
await db.exec(`SELECT sjd_receive('00000000-0000-0000-0000-00000000dd51','[{"line_id":"00000000-0000-0000-0000-0000000000bb","action":"reserve","job_id":"00000000-0000-0000-0000-0000000000b3","product_id":"00000000-0000-0000-0000-000000000f06","model_code":"UNITVAR","qty_packs":1,"unit_cost_pack":130,"bucket":"job_unit"}]')`);
const varRow = await one(`SELECT unit_id IS NOT NULL AS on_unit, value_adjust FROM stock_movements WHERE reason='Invoice cost variance' AND supplier_document_line_id='00000000-0000-0000-0000-0000000000bb'`);
if (!varRow?.on_unit || Number(varRow.value_adjust) !== 30) fail("variance must sit on the unit " + JSON.stringify(varRow));
await db.exec(`SELECT job_book_out_units('00000000-0000-0000-0000-0000000000b3')`);
const left = await one(`SELECT coalesce(sum(m.qty*coalesce(m.unit_cost_excl,0)+m.value_adjust),0) AS v, coalesce(sum(m.qty),0) AS q FROM stock_movements m JOIN cf_stock_items s ON s.id=m.stock_item_id WHERE s.model_code='UNITVAR' AND public.stock_qty_counts(m.kind,m.supplier_document_id,m.supplier_document_line_id)`);
if (Number(left.q) !== 0 || Number(left.v) !== 0) fail("installed unit must leave no stock value " + JSON.stringify(left));

let tooMuch = false;
try {
  await db.exec(`
    INSERT INTO supplier_job_documents(id,company_id,doc_type,doc_number,po_number) VALUES ('00000000-0000-0000-0000-00000000dd14','${co}','credit_note','CN-BIG','PO-C');
    INSERT INTO supplier_job_document_lines(id,document_id,company_id,line_no,model_number,qty) VALUES ('00000000-0000-0000-0000-0000000000c5','00000000-0000-0000-0000-00000000dd14','${co}',1,'COPPER-TEST',5);
  `);
  await db.query(`SELECT sjd_receive('00000000-0000-0000-0000-00000000dd14','[{"line_id":"00000000-0000-0000-0000-0000000000c5","action":"stock","product_id":"00000000-0000-0000-0000-000000000f03","model_code":"COPPERTEST","qty_packs":5,"unit_cost_pack":12}]')`);
} catch (e) { tooMuch = /more than/.test(e.message); }
if (!tooMuch) fail("credit larger than the open receipt must be rejected");

await db.exec(`
INSERT INTO supplier_products(id,product_code,name,cost_price,product_type) VALUES ('00000000-0000-0000-0000-000000000f07','UNIT-SER','Serial unit',50,'ac_unit');
INSERT INTO supplier_job_documents(id,company_id,doc_type,doc_number,po_number) VALUES
 ('00000000-0000-0000-0000-00000000dd60','${co}','delivery_note','DN-S','PO-S'),
 ('00000000-0000-0000-0000-00000000dd61','${co}','credit_note','CN-S','PO-S'),
 ('00000000-0000-0000-0000-00000000dd62','${co}','delivery_note','DN-S2','PO-S2');
INSERT INTO supplier_job_document_lines(id,document_id,company_id,line_no,model_number,qty) VALUES
 ('00000000-0000-0000-0000-0000000000ca','00000000-0000-0000-0000-00000000dd60','${co}',1,'UNIT-SER',2),
 ('00000000-0000-0000-0000-0000000000cb','00000000-0000-0000-0000-00000000dd61','${co}',1,'UNIT-SER',1),
 ('00000000-0000-0000-0000-0000000000cc','00000000-0000-0000-0000-00000000dd62','${co}',1,'UNIT-SER',1);
`);
await db.exec(`SELECT sjd_receive('00000000-0000-0000-0000-00000000dd60','[{"line_id":"00000000-0000-0000-0000-0000000000ca","action":"stock","product_id":"00000000-0000-0000-0000-000000000f07","model_code":"UNITSER","qty_packs":2,"unit_cost_pack":50,"bucket":"general_unit","serial_no":"SA,SB","delivered":true}]')`);
await db.exec(`SELECT sjd_receive('00000000-0000-0000-0000-00000000dd61','[{"line_id":"00000000-0000-0000-0000-0000000000cb","action":"stock","product_id":"00000000-0000-0000-0000-000000000f07","model_code":"UNITSER","qty_packs":1,"unit_cost_pack":50,"serial_no":"SA"}]')`);
const ret = await one(`SELECT count(*)::int AS n FROM stock_units WHERE supplier_code='UNITSER' AND serial_no='SA' AND returned_at IS NOT NULL`);
const kept = await one(`SELECT count(*)::int AS n FROM stock_units WHERE supplier_code='UNITSER' AND serial_no='SB' AND returned_at IS NULL`);
if (ret.n !== 1 || kept.n !== 1) fail("credit should return only serial SA " + JSON.stringify({ ret, kept }));
await db.exec(`SELECT sjd_receive('00000000-0000-0000-0000-00000000dd62','[{"line_id":"00000000-0000-0000-0000-0000000000cc","action":"stock","product_id":"00000000-0000-0000-0000-000000000f07","model_code":"UNITSER","qty_packs":1,"unit_cost_pack":50,"bucket":"general_unit","serial_no":"SA","delivered":true}]')`);
const againSa = await one(`SELECT count(*)::int AS live FROM stock_units WHERE supplier_code='UNITSER' AND serial_no='SA' AND returned_at IS NULL`);
if (againSa.live !== 1) fail("returned serial SA must be receivable again");

let stranger = false;
await db.exec(`DELETE FROM okco`);
try { await db.query(`SELECT sjd_receive('00000000-0000-0000-0000-00000000dd01','[]')`); } catch (e) { stranger = /not allowed/.test(e.message); }
if (!stranger) fail("another company must not receive");

if (process.exitCode) process.exit(process.exitCode);
console.log("stock buckets ok");
