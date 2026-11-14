const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../tools/build-site.cjs'),'utf8');
function build(env){
  const copied=[],written=new Map();
  const fakeFs={readFileSync:()=> 'window.WATCH_CONFIG={};',mkdirSync(){},copyFileSync:(from,to)=>copied.push(to),writeFileSync:(p,s)=>written.set(p,s)};
  vm.runInNewContext(source,{require:id=>id==='node:fs'?fakeFs:require(id),__dirname,Buffer,process:{env},console:{log(){}}});
  return {copied,written};
}
test('publishing requires a backend and rejects privileged keys',()=>{
  assert.throws(()=>build({}),/SUPABASE_URL/);
  assert.throws(()=>build({SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_secret_not-public'}),/cannot be published/);
  const jwt='header.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.signature';
  assert.throws(()=>build({SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:jwt}),/cannot be published/);
});
test('build includes series and only public website assets',()=>{
  const result=build({SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'});
  assert.equal(result.copied.length,8);
  assert.ok(result.copied.some(p=>p.endsWith(require('node:path').join('admin','index.html'))));
  assert.ok(result.copied.some(p=>p.endsWith(require('node:path').join('admin','admin.js'))));
  assert.ok(result.copied.some(p=>p.endsWith('series.js')));
  assert.ok(!result.copied.some(p=>p.endsWith('.sql')));
  assert.ok([...result.written.values()].some(s=>s.includes('sb_publishable_test')));
});
test('publishing rejects concatenated keys even when a public key comes first',()=>{
  const anon='header.'+Buffer.from(JSON.stringify({role:'anon'})).toString('base64url')+'.signature';
  for(const key of [anon+'\nsb_secret_hidden',anon+' sb_secret_hidden','sb_publishable_test\nsb_secret_hidden',anon+'.extra']) {
    assert.throws(()=>build({SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:key}),/cannot be published/);
  }
  assert.doesNotThrow(()=>build({SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:anon}));
});
