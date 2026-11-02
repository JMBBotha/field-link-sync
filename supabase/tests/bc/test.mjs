import { PGlite } from "@electric-sql/pglite";
import fs from "fs";
const db = new PGlite();
await db.exec(fs.readFileSync("stub.sql","utf8"));
await db.exec(fs.readFileSync(process.argv[2],"utf8"));
const q = async (s, p=[]) => (await db.query(s, p)).rows;
const one = async (s,p) => Object.values((await q(s,p))[0])[0];
let pass=0, fail=0; const ok=(c,m)=>{ if(c){pass++;console.log("PASS",m)} else {fail++;console.log("FAIL",m)} };
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,"0")}`;
const C1=id(9001), C2=id(9002), A=id(1), O=id(2), RC=id(3), X=id(4);
const T = s => `2026-11-${s}+02`; // SAST
await q(`insert into company_members(user_id,company_id,role,is_owner) values ($1,$5,'admin',false),($2,$5,'member',true),($3,$5,'member',false),($4,$6,'admin',true)`,[A,O,RC,X,C1,C2]);
// Demo Rep 1-8 : base pin at -34.0,18.8 ; job pin same. distance grows with n. Rep 2 offline (closest), Rep 5 has skill.
for (let n=1;n<=8;n++){ const r=id(100+n);
  await q(`insert into profiles(id,full_name,dispatch_role,availability_status,home_lat,home_lng,skills) values ($1,$2,'sales',$3,$4,18.8,$5)`,[r,`Demo Rep ${n}`, n===2?'offline':'available', -34.0 - n*0.01, n===5||n===6?['split']:[]]);
  await q(`insert into company_members(user_id,company_id,role) values ($1,$2,'member')`,[r,C1]); }
// Rep 5 & 6 same distance tie broken by skill: put 6 at rep5 distance with no skill
await q(`update profiles set home_lat=-34.05, skills='{}' where id=$1`,[id(106)]); await q(`update profiles set skills='{split}' where id=$1`,[id(105)]);
await q(`insert into customers values ($1,-34.0,18.8,$2,null)`,[id(500),RC]);
await q(`insert into leads values ($1,-34.0,18.8,'{split}')`,[id(600)]);
const recip = async (rid,kind) => (await q(`select recipient_id from request_alerts where request_id=$1 and kind=$2 order by 1`,[rid,kind])).map(r=>r.recipient_id);
// ---- B
const R1=id(701),R2=id(702),R3=id(703),R4=id(704),R5=id(705),R6=id(706);
await q(`insert into requests(id,company_id,type,area,created_at) values ($1,$2,'new_sale','Demo A','${T("02 09:00")}')`,[R1,C1]);
await q(`insert into requests(id,company_id,type,area,created_at) values ($1,$2,'new_sale','Demo B','${T("06 16:00")}')`,[R2,C1]);
await q(`insert into requests(id,company_id,type,assigned_to,created_at) values ($1,$2,'service',$3,'${T("02 09:00")}')`,[R3,C1,id(101)]);
await q(`insert into requests(id,company_id,type,customer_id,first_contact_at,created_at) values ($1,$2,'move',$3,'${T("02 09:30")}','${T("02 09:00")}')`,[R4,C1,id(500)]);
await q(`insert into requests(id,company_id,type,source,task_due_at,created_at) values ($1,$2,'admin','manual','${T("02 10:00")}','${T("02 08:00")}')`,[R5,C1]);
await q(`insert into requests(id,company_id,type,created_at) values ($1,$2,'new_sale','${T("02 09:00")}')`,[R6,C2]);
const tick = t => one(`select fl_request_alerts_tick('${T(t)}')`);
await tick("02 10:59"); ok((await recip(R1,'not_contacted')).length===0, "B not_contacted: nothing at 1h59 working");
await tick("02 11:01"); ok(JSON.stringify(await recip(R1,'not_contacted'))===JSON.stringify([A,O].sort()), "B not_contacted at 2h01 -> admin + owner only");
const before = await one(`select count(*)::int from notifications`); await tick("02 11:01"); await tick("02 11:06");
ok(await one(`select count(*)::int from notifications`)===before, "B rerun tick = no duplicate alerts");
ok((await recip(R6,'not_contacted')).includes(X) && !(await recip(R6,'not_contacted')).includes(A), "B company-scoped: other company's request only alerts its own admin");
// unscheduled at 24 working h: Mon 9:00 -> Wed 15:00  (reset to test service/move from scratch using fresh tick times is fine; kinds are separate)
ok((await recip(R3,'service_unscheduled')).length===0 && (await recip(R4,'move_unscheduled')).length===0, "B service/move: nothing before 24 working h");
await tick("04 14:59"); ok((await recip(R3,'service_unscheduled')).length===0, "B service: Wed 14:59 (1439 wmin) no alert");
await tick("04 15:01");
ok(JSON.stringify(await recip(R3,'service_unscheduled'))===JSON.stringify([A,O,id(101)].sort()), "B service assigned-no-date at 24h01 -> assignee + admin + owner");
ok(JSON.stringify(await recip(R4,'move_unscheduled'))===JSON.stringify([A,O,RC].sort()), "B move -> client's own rep + admin + owner");
ok((await recip(R3,'not_contacted')).length===0 && (await recip(R4,'not_contacted')).length===0, "B assigned/contacted requests never get not_contacted");
await tick("07 12:00"); ok((await recip(R2,'not_contacted')).length===0, "B weekend: Fri 16:00 request, Sat noon = 60 working min, no alert");
await tick("09 08:59"); ok((await recip(R2,'not_contacted')).length===0, "B Mon 08:59 = 60 working min, no alert");
await tick("09 09:01"); ok((await recip(R2,'not_contacted')).length===2, "B Mon 09:01 = 121 working min -> alert");
const t5a = await q(`select count(*)::int c from request_alerts where request_id=$1`,[R5]);
ok(t5a[0].c>0, "B admin task due Mon 10:00 -> overdue by Wed (more than 1 working day)");
ok(await one(`select count(*)::int from audit_log where action='request_alert'`) >= 6, "B audit_log row per alert batch");
ok(await one(`select count(*)::int from notifications where type='request_alert' and user_id not in (select user_id from company_members)`)===0, "B recipients are staff members only");
// task overdue boundary on a fresh one
const R7=id(707); await q(`insert into requests(id,company_id,type,source,task_due_at,created_at) values ($1,$2,'admin','manual','${T("09 10:00")}','${T("09 08:00")}')`,[R7,C1]);
await tick("10 09:59"); ok((await recip(R7,'task_overdue')).length===0, "B task: Tue 09:59 (539 wmin) not overdue");
await tick("10 10:01"); ok((await recip(R7,'task_overdue')).length===2, "B task: Tue 10:01 (541 wmin) overdue -> admin + owner");
await q(`update request_alert_settings set enabled=false`); 
// ---- C
await q(`update requests set status='closed'`);
ok(await one(`select count(*)::int from lead_offer_settings`)===0, "C ships off: no settings rows, default enabled=false");
ok(await one(`select (select column_default from information_schema.columns where table_name='lead_offer_settings' and column_name='enabled')`)==='false', "C enabled column defaults to false");
const N=id(801);
await q(`insert into requests(id,company_id,type,area,customer_name,phone,lead_id,created_at) values ($1,$2,'new_sale','Demo Estate / Somerset West — House 12','Demo Client A','0000000000',$3,'${T("09 09:00")}')`,[N,C1,id(600)]);
const otick = t => one(`select fl_offer_tick('${T(t)}')`);
ok(await otick("09 09:00")===0, "C off: tick does nothing");
await q(`insert into lead_offer_settings(company_id,enabled,enabled_at) values ($1,true,'${T("09 08:00")}')`,[C1]);
const rank = (await q(`select * from rank_reps_for_request($1)`,[N])).map(r=>r.rep_id);
ok(JSON.stringify(rank)===JSON.stringify([101,103,104,105,106,107,108,102].map(id)), "C ranking: available first (Rep 2 offline last), distance, then skill (Rep 5 before Rep 6 at equal distance)");
const offered = async () => (await q(`select rep_id,wave from request_offers where request_id=$1 order by rank`,[N]));
ok(await otick("09 09:00")===3, "C wave 1 = top 3 at 0 min");
ok(JSON.stringify((await offered()).map(r=>r.rep_id))===JSON.stringify([101,103,104].map(id)), "C wave 1 is Rep 1,3,4");
ok(await otick("09 09:04")===0, "C nothing new at 4 min");
ok(await otick("09 09:05")===2, "C +2 at 5 min");
ok(await otick("09 09:06")===0, "C nothing at 6 min");
ok(await otick("09 09:07")===2, "C +2 at 7 min");
ok(await otick("09 09:09")===1, "C +2 at 9 min (only 1 rep left)");
const esc = () => one(`select count(*)::int from notifications where type='request_offer_unclaimed'`);
ok(await esc()===0, "C no escalation before 10 min");
await otick("09 09:10"); ok(await esc()===1, "C 10 min: one alert to the owner (escalate_to unset -> owner)");
ok(await one(`select user_id from notifications where type='request_offer_unclaimed'`)===O, "C escalation recipient = owner");
await otick("09 09:11"); await otick("09 09:20"); ok(await esc()===1, "C escalation fires exactly once");
// masking
await q(`select set_config('test.uid',$1,false)`,[id(101)]);
const v = (await q(`select * from my_request_offers()`))[0];
ok(v.area==='Somerset West' && v.customer_name===null && v.phone===null && v.address===null && v.state==='open', "C pre-accept payload: type + rough area only, no name/phone/address");
ok(!Object.keys(v).some(k=>/rep|staff|other/.test(k)), "C payload never lists other reps");
const bodies = (await q(`select body from notifications where type='request_offer'`)).map(r=>r.body);
ok(bodies.every(b=>b==='New sale · Somerset West'), "C offer bell text has no client name");
// race: Rep 3 and Rep 1 accept
await q(`select set_config('test.uid',$1,false)`,[id(103)]); const a1 = await one(`select accept_request_offer((select id from request_offers where rep_id=$1 and request_id=$2))`,[id(103),N]);
await q(`select set_config('test.uid',$1,false)`,[id(101)]); const a2 = await one(`select accept_request_offer((select id from request_offers where rep_id=$1 and request_id=$2))`,[id(101),N]);
ok(a1==='accepted' && a2==='taken', "C race: first accept wins, second gets 'taken'");
ok(await one(`select assigned_to from requests where id=$1`,[N])===id(103), "C request assigned to the winner");
const lost = (await q(`select * from my_request_offers()`))[0]; ok(lost.state==='taken' && lost.customer_name===null, "C loser sees Taken, still no details");
await q(`select set_config('test.uid',$1,false)`,[id(103)]); const won = (await q(`select * from my_request_offers()`))[0];
ok(won.state==='accepted' && won.customer_name==='Demo Client A', "C winner sees full details");
ok(await one(`select count(*)::int from request_offers where request_id=$1 and status='withdrawn'`,[N])===7, "C other 7 offers withdrawn");
// settings respected: first_wave 5, new request
await q(`update lead_offer_settings set first_wave=5`); const N2=id(802);
await q(`insert into requests(id,company_id,type,area,created_at) values ($1,$2,'new_sale','Demo Area','${T("09 12:00")}')`,[N2,C1]);
ok(await otick("09 12:00")===5, "C settings respected: first_wave 5");
const N3=id(803); await q(`insert into requests(id,company_id,type,created_at) values ($1,$2,'new_sale','${T("09 07:00")}')`,[N3,C1]);
await otick("09 12:01"); ok(await one(`select count(*)::int from request_offers where request_id=$1`,[N3])===0, "C requests from before switch-on are not offered");
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
