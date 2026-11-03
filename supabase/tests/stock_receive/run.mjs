// Dry-run of 20261102210000_stock_receive.sql on an in-memory Postgres (PGlite) with a stub schema and dummy data.
// npm i -D @electric-sql/pglite (or run from a folder that has it), then: node supabase/tests/stock_receive/run.mjs
import { PGlite } from "@electric-sql/pglite"; import fs from "fs"; import path from "path"; import { fileURLToPath } from "url";
const here = path.dirname(fileURLToPath(import.meta.url)); const mig = path.join(here, "../../migrations");
const db = new PGlite();
await db.exec(fs.readFileSync(path.join(here, "stub.sql"), "utf8"));
const ch = fs.readFileSync(path.join(mig, "20261019110000_cash_health.sql"), "utf8");
await db.exec(ch.slice(ch.indexOf("CREATE OR REPLACE FUNCTION public.cf_allocate_stock"), ch.indexOf("CREATE OR REPLACE FUNCTION public.cf_unallocate_stock")));
await db.exec(fs.readFileSync(path.join(mig, "20261102210000_stock_receive.sql"), "utf8"));
await db.exec(fs.readFileSync(path.join(mig, "20261103080000_stock_pair_reserve_cost.sql"), "utf8"));
for (const stmt of fs.readFileSync(path.join(here, "scenario.sql"), "utf8").split(/;\n/).filter((s) => s.trim())) {
  try { const r = await db.query(stmt); if (/^\s*SELECT/i.test(stmt)) console.log(JSON.stringify(r.rows)); }
  catch (e) { console.log("ERR:", e.message, "<=", stmt.trim().slice(0, 70)); }
}
