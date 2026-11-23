// Requires Docker and an available postgres:17 image. No host ports or real database access.
const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const container='friday-watch-history-qa-'+process.pid;
let started=false;
function docker(args,input){
  const result=spawnSync('docker',args,{input,encoding:'utf8',windowsHide:true,maxBuffer:5e6});
  if(result.error||result.status!==0)throw Error(result.error?.message||result.stderr||result.stdout);
  return result.stdout.trim();
}
const sql=text=>docker(['exec','-i',container,'psql','-X','-h','127.0.0.1','-U','postgres','-v','ON_ERROR_STOP=1','-qAt'],text);
const file=name=>fs.readFileSync(path.join(root,name),'utf8');
(async()=>{
  docker(['run','--rm','-d','--network','none','--name',container,'-e','POSTGRES_PASSWORD=local-disposable-test-only','postgres:17']);started=true;
  let ready=false;
  for(let n=0;n<80;n++){
    const result=spawnSync('docker',['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres'],{windowsHide:true,stdio:'ignore'});
    if(result.status===0){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,250));
  }
  assert.ok(ready,'Disposable PostgreSQL did not become ready');
  sql('create schema extensions; create role anon; create role authenticated;');
  sql(file('supabase/schema.sql').replace('REPLACE-WITH-A-LONG-RANDOM-GROUP-CODE','friday-night-test-code-only'));
  sql(file('supabase/seed.sql'));
  sql("insert into watch_private.votes(item_id,name,interest) values('00000000-0000-4000-8000-000000000001','Alex','hold');");
  sql("insert into watch_private.items(id,title,type,watched) values('88888888-8888-4888-8888-888888888888','Legacy watched fixture','movie',true);");
  for(const name of ['admin','personal-seen','watch-history'])sql(file('supabase/'+name+'-migration.sql'));
  assert.equal(sql("select interest from watch_private.votes where item_id='00000000-0000-4000-8000-000000000001' and name='Alex';"),'hold','Migration changed a saved vote');
  assert.equal(sql("select watched and watched_at is null and watched_on is null and watched_attendees is null from watch_private.items where id='88888888-8888-4888-8888-888888888888';"),'t','Migration invented metadata for a legacy watch');
  sql("delete from watch_private.items where id='88888888-8888-4888-8888-888888888888';");
  for(const name of ['database','admin-database','personal-seen-database','tv-database','watch-history-database']){
    const source=file('tests/'+name+'.test.sql');
    sql(name==='watch-history-database'?source:"begin; select set_config('friday.test_group','friday-night-test-code-only',true);\n"+source+'\nrollback;');console.log('PASS: '+name);
  }
  sql("select public.watch_api('friday-night-test-code-only','watched','{\"id\":\"00000000-0000-4000-8000-000000000001\",\"watched\":true,\"attendees\":[\"Alex\"],\"recorded_by\":\"Alex\"}');");
  const snapshot=sql("select public.watch_api('friday-night-test-code-only','list');");
  sql(file('supabase/watch-history-migration.sql'));
  assert.equal(sql("select public.watch_api('friday-night-test-code-only','list');"),snapshot,'Rerunning the migration changed items, votes or personal history');
  console.log('PASS: legacy records preserved and migration is idempotent');
  sql(`insert into watch_private.items(id,title,type,year,watched,watched_at,watched_on,watched_attendees,watched_by) values
    ('11111111-1111-4111-8111-111111111111','It Takes Two','movie','1995',true,'2026-11-20T22:00:00Z','2026-11-20',array['Alex','Lyss'],'Alex'),
    ('22222222-2222-4222-8222-222222222222','Passport to Paris','movie','1999',false,null,null,null,null),
    ('33333333-3333-4333-8333-333333333333','It Takes Two (1988)','movie','1988',false,null,null,null,null);
    insert into watch_private.votes(item_id,name,interest) values('11111111-1111-4111-8111-111111111111','Alex','hold');
    insert into watch_private.seen(item_id,name) values('22222222-2222-4222-8222-222222222222','Lyss');`);
  sql(file('supabase/mary-kate-ashley-series.sql'));
  const parent=JSON.parse(sql("select to_jsonb(i) from watch_private.items i where title='Mary-Kate & Ashley' and type='series';"));
  assert.equal(parent.films.length,2);
  assert.equal(sql("select count(*) from watch_private.items where id in ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222');"),'0','Individual movie entries remain');
  assert.equal(sql("select count(*) from watch_private.votes where item_id='11111111-1111-4111-8111-111111111111';"),'0','Individual votes remain');
  assert.equal(sql("select count(*) from watch_private.items where id='33333333-3333-4333-8333-333333333333';"),'1','Unrelated remake was removed');
  const progress=JSON.parse(sql("select jsonb_agg(to_jsonb(p)) from watch_private.progress p join watch_private.items i on i.id=p.item_id where i.title='Mary-Kate & Ashley';"));
  assert.ok(progress.some(p=>p.name==='Group'&&p.film==='It Takes Two (1995)'&&p.watched_on==='2026-11-20'&&p.watched_attendees.join(',')==='Alex,Lyss'));
  assert.ok(progress.some(p=>p.name==='Lyss'&&p.film==='Passport to Paris (1999)'));
  sql(`select public.watch_api('friday-night-test-code-only','vote','{"id":"${parent.id}","name":"Alex","interest":"interested"}');`);
  sql(file('supabase/mary-kate-ashley-series.sql'));
  assert.equal(sql("select interest from watch_private.votes where item_id='"+parent.id+"' and name='Alex';"),'interested','Rerun lost the series vote');
  assert.equal(sql("select count(*) from watch_private.items where title='Mary-Kate & Ashley' and type='series';"),'1','Rerun duplicated the series');
  sql("insert into watch_private.items(title,type,year) values('New York Minute','movie','2004');");
  sql(file('supabase/mary-kate-ashley-series.sql'));
  assert.equal(sql("select jsonb_array_length(films) from watch_private.items where id='"+parent.id+"';"),'3','Later consolidation lost the existing film checklist');
  console.log('PASS: Mary-Kate and Ashley consolidated into one votable series, old votes removed, viewing history preserved, safe reruns');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{if(started)docker(['rm','-f',container]);});
