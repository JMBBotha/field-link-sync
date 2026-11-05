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
if (Number(dn.r.reserved) !== 1) fail("delivery note should reserve without stock, got " + JSON.stringify(dn));
const movesAfterDn = await one(`SELECT count(*)::int n FROM stock_movements`);
if (movesAfterDn.n !== 0) fail("delivery note must not write a movement");

const inv = await one(`SELECT sjd_receive('00000000-0000-0000-0000-00000000dd02','[
  {"line_id":"00000000-0000-0000-0000-0000000000a2","action":"reserve","job_id":"${job}","product_id":"${prod}","model_code":"FCMI24","item":"Test 24K","qty_packs":1,"unit_cost_pack":11000,"cost_source":"invoice","bucket":"job_unit","half":"indoor","vat_rate":15},
  {"line_id":"00000000-0000-0000-0000-0000000000a3","action":"stock","product_id":"${gas}","model_code":"G005","item":"R410a","stock_unit":"kg","pack_size":11.3,"qty_packs":2,"unit_cost_pack":2260,"cost_source":"invoice","bucket":"material_pool","vat_rate":15}
]') AS r`);
if (Number(inv.r.stocked) < 1) fail("invoice should add stock " + JSON.stringify(inv));

const buckets = await q(`SELECT bucket, kind, qty, unit_cost_excl FROM stock_movements ORDER BY bucket, kind`);
const jobRecv = buckets.filter((b) => b.bucket === "job_unit" && b.kind === "receive");
const pool = buckets.filter((b) => b.bucket === "material_pool" && b.kind === "receive");
if (jobRecv.length !== 1 || Number(jobRecv[0].unit_cost_excl) !== 11000) fail("job unit must keep actual cost 11000 " + JSON.stringify(jobRecv));
if (pool.length !== 1 || Number(pool[0].qty) !== 22.6) fail("gas must land in the materials pool " + JSON.stringify(pool));
const allocOnJobUnit = await one(`SELECT count(*)::int n FROM stock_movements WHERE unit_id IN (SELECT id FROM stock_units WHERE origin='job_received') AND kind='allocate'`);
if (allocOnJobUnit.n !== 0) fail("job-received unit must not also be allocated");

const vat = await one(`SELECT vat_amount FROM supplier_job_document_lines WHERE id='00000000-0000-0000-0000-0000000000a3'`);
if (Number(vat.vat_amount) !== 678) fail("gas VAT should be 678, got " + vat.vat_amount);

const again = await one(`SELECT sjd_receive('00000000-0000-0000-0000-00000000dd02','[{"line_id":"00000000-0000-0000-0000-0000000000a3","action":"stock","pack_size":11.3,"qty_packs":2}]') AS r`);
if (Number(again.r.already_received) < 1) fail("second confirm must be idempotent");
const moveCount = await one(`SELECT count(*)::int n FROM stock_movements`);
if (moveCount.n !== 2) fail("idempotent confirm must not add movements, have " + moveCount.n);

let blocked = false;
try {
  const unit = await one(`SELECT id FROM stock_units WHERE origin='job_received' LIMIT 1`);
  await db.query(`SELECT stock_assign_unit('${unit.id}','00000000-0000-0000-0000-0000000000b2')`);
} catch (e) { blocked = /cannot also be moved/.test(e.message); }
if (!blocked) fail("assigning a job-received unit must fail");

await db.exec(`SELECT sjd_receive('00000000-0000-0000-0000-00000000dd04','[{"line_id":"00000000-0000-0000-0000-0000000000a6","action":"stock","product_id":"${prod}","model_code":"FCMI24","item":"Test 24K","qty_packs":1,"unit_cost_pack":9000,"cost_source":"invoice","bucket":"general_unit","half":"indoor"}]')`);
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
const adjusts = await one(`SELECT count(*)::int n FROM stock_movements WHERE kind='adjust'`);
if (adjusts.n !== 1) fail("expected one adjust, got " + adjusts.n);
let frozen = false;
try { await db.query(`UPDATE stock_movements SET qty = 0 WHERE kind='adjust'`); } catch (e) { frozen = /append-only/.test(e.message); }
if (!frozen) fail("movements must reject updates");

let stranger = false;
await db.exec(`DELETE FROM okco`);
try { await db.query(`SELECT sjd_receive('00000000-0000-0000-0000-00000000dd01','[]')`); } catch (e) { stranger = /not allowed/.test(e.message); }
if (!stranger) fail("another company must not receive");

if (process.exitCode) process.exit(process.exitCode);
console.log("stock buckets ok");
