// node test.mjs  (from this folder). Loads dummy schema + live functions + the new migration into PGlite.
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const db = new PGlite();
for (const f of ["stub.sql","_live_notify_document_sent.sql","../../migrations/20261102200000_walda_invoice_mark_sent.sql","after_fns.sql"]) await db.exec(fs.readFileSync(f,"utf8"));
const q = async (s,p=[]) => (await db.query(s,p)).rows;
const one = async (s,p) => Object.values((await q(s,p))[0])[0];
let pass=0, fail=0; const ok=(c,m)=>{ if(c){pass++;console.log("PASS",m)} else {fail++;console.log("FAIL",m)} };
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,"0")}`;
const C1=id(9001), C2=id(9002), BOT=id(1), ADM=id(2), ADM2=id(3);
await q(`insert into companies values ($1,'Demo Co A','accounts@demo-a.test'),($2,'Demo Co B',null)`,[C1,C2]);
await q(`insert into company_members values ($1,$3,'admin'),($2,$4,'admin')`,[ADM,ADM2,C1,C2]);
await q(`select set_config('test.bot',$1,false), set_config('test.botco',$2,false)`,[BOT,C1]);
const as = u => q(`select set_config('test.uid',$1,false)`,[u]);
const mk = async (n,co,status='draft') => { await q(`insert into invoices(id,company_id,invoice_number,status,customer_name,customer_email,grand_total,notes) values ($1,$2,$3,$4,'Demo Client '||$5,'client'||$5||'@example.test',1000,'keep me')`,[id(1000+n),co,`DEMO-${n}`,status,String(n)]); return id(1000+n); };
const propose = async ids => { await as(BOT); return one(`select propose_change('invoice_mark_sent',$1,$2::jsonb)`,[`Mark ${ids.length} sent`, JSON.stringify({invoice_ids:ids})]); };
const review = async (pid,u=ADM) => { await as(u); return one(`select review_proposed_change($1,true,null)`,[pid]); };
const emails = () => one(`select (select count(*) from net.calls)+(select count(*) from email_events)`);
const outbox = () => one(`select (select count(*) from entity_outbox)+(select count(*) from push_outbox)`);

// control: the harness does catch emails (old invoice_send path)
const ctl = await mk(99,C1); let r;
await as(BOT); const pc = await one(`select propose_change('invoice_send','ctl',$1::jsonb)`,[JSON.stringify({invoice_id:ctl})]);
await review(pc); ok(Number(await emails())>0 && Number(await outbox())>0, "control: normal invoice_send does email + outbox (harness detects sends)");
await q(`truncate net.calls, email_events, entity_outbox, push_outbox`);

// batch of 12, one approval
const ids=[]; for (let n=1;n<=12;n++) ids.push(await mk(n,C1));
const pid = await propose(ids);
ok(Number(await one(`select count(*) from bot_proposed_changes where action_type='invoice_mark_sent'`))===1, "12 invoices = 1 proposal");
ok(Number(await one(`select count(*) from invoices where id=any($1) and status='draft'`,[ids]))===12, "nothing changes before approval");
r = await review(pid);
ok(r.status==='applied' && r.result.marked_sent===12, "one approval marks all 12 sent: "+JSON.stringify(r).slice(0,80));
ok(Number(await one(`select count(*) from invoices where id=any($1) and status='sent' and sent_method='external' and sent_note='sent from FreshBooks' and sent_by=$2 and sent_at is not null and notes='keep me'`,[ids,ADM]))===12, "status sent, sent_method external, note 'sent from FreshBooks', client notes untouched");
ok(Number(await emails())===0, "no email: 0 net.http_post calls, 0 email_events (incl. no accounts copy)");
ok(Number(await outbox())===0, "no outbox rows");
ok(Number(await one(`select count(*) from bot_proposed_changes where id=$1 and status='applied' and reviewer_id=$2`,[pid,ADM]))===1, "proposal applied by reviewer");
ok(await one(`select coalesce(current_setting('app.invoice_skip_email',true),'')`)!=='on', "skip flag not left on after the batch");

// reject non-draft: all-or-nothing
const d1=await mk(20,C1), s1=await mk(21,C1,'sent'), p1=await mk(22,C1,'paid');
r = await review(await propose([d1,s1,p1]));
ok(r.status==='failed' && /not draft/.test(r.error), "non-draft in batch -> proposal failed: "+r.error);
ok(await one(`select status from invoices where id=$1`,[d1])==='draft' && await one(`select status from invoices where id=$1`,[p1])==='paid', "failed batch changes nothing (draft stays draft, paid stays paid)");

// company scoping
const other = await mk(30,C2); const mine = await mk(31,C1);
r = await review(await propose([mine,other]));
ok(r.status==='failed' && /not found in this company/.test(r.error), "other company's invoice rejected: "+r.error);
ok(await one(`select status from invoices where id=$1`,[other])==='draft' && await one(`select status from invoices where id=$1`,[mine])==='draft', "neither invoice touched");
const pX = await propose([mine]);
await as(ADM2); let e=null; try{ await q(`select review_proposed_change($1,true,null)`,[pX]); }catch(x){e=x.message}
ok(/Only an admin/.test(e||''), "admin of another company cannot approve: "+e);
await as(BOT); e=null; try{ await q(`select review_proposed_change($1,true,null)`,[pX]); }catch(x){e=x.message}
ok(e!==null, "bot cannot approve its own proposal: "+e);
await as(ADM); e=null; try{ await q(`select propose_change('invoice_mark_sent','x','{"invoice_ids":[]}')`); }catch(x){e=x.message}
ok(/not allowed/.test(e||''), "only the accounts bot can propose");
r = await review(await propose([])); ok(r.status==='failed' && /invoice_ids/.test(r.error), "empty list rejected");
ok(await one(`select bot_action_kind('invoice_mark_sent')`)==='executable', "bot_action_kind = executable");
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
