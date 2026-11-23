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
  sql("insert into watch_private.items(id,title,type,watched) values('88888888-8888-4888-8888-888888888888','Legacy watched fixture','movie',true);");
  for(const name of ['admin','personal-seen','watch-history'])sql(file('supabase/'+name+'-migration.sql'));
  assert.equal(sql("select watched and watched_at is null and watched_on is null and watched_attendees is null from watch_private.items where id='88888888-8888-4888-8888-888888888888';"),'t','Migration invented metadata for a legacy watch');
  sql("delete from watch_private.items where id='88888888-8888-4888-8888-888888888888';");
  for(const name of ['database','admin-database','personal-seen-database','tv-database','watch-history-database']){
    const source=file('tests/'+name+'.test.sql');
    sql(name==='watch-history-database'?source:"begin; select set_config('friday.test_group','friday-night-test-code-only',true);\n"+source+'\nrollback;');console.log('PASS: '+name);
  }
  sql("select public.watch_api('friday-night-test-code-only','watched','{\"id\":\"00000000-0000-4000-8000-000000000001\",\"watched\":true,\"attendees\":[\"Alex\"],\"recorded_by\":\"Alex\"}');");
  const snapshot=sql("select jsonb_agg(to_jsonb(i) order by id) from watch_private.items i;");
  sql(file('supabase/watch-history-migration.sql'));
  assert.equal(sql("select jsonb_agg(to_jsonb(i) order by id) from watch_private.items i;"),snapshot,'Rerunning the migration changed existing data');
  console.log('PASS: legacy records preserved and migration is idempotent');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{if(started)docker(['rm','-f',container]);});
