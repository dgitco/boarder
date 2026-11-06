import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import * as U from './direct-uploads.ts';
function setup() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0093_direct_upload.sql', import.meta.url), 'utf8'));
  sqlite.exec('CREATE TABLE user_pref(owner TEXT,k TEXT,v TEXT,at INTEGER,PRIMARY KEY(owner,k))');
  const stmt = (sql: string, args: any[] = []): any => ({ sql, args, bind: (...a: any[]) => stmt(sql,a), first: async () => sqlite.prepare(sql).get(...args) || null, run: async () => sqlite.prepare(sql).run(...args), all: async () => ({results: sqlite.prepare(sql).all(...args)}) });
  const DB = { prepare: stmt, batch: async (ss: any[]) => { sqlite.exec('BEGIN');try { const r = ss.map(x => ({results: sqlite.prepare(x.sql).all(...x.args)})); sqlite.exec('COMMIT');return r; } catch(e) { sqlite.exec('ROLLBACK');throw e; } } };
  const objects = new Map<string, any>(), multipart: any[] = [];
  const RESULTS = { head: async (key: string) => objects.get(key) || null, delete: async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key); },
    createMultipartUpload: async (key: string) => ({uploadId:'multi-'+key,abort:async()=>{}}),
    resumeMultipartUpload: (key: string,uploadId:string) => ({complete:async(parts:any[]) => { multipart.push(parts);const s=sqlite.prepare('SELECT size FROM direct_upload WHERE source=?').get(key) as any;objects.set(key,{size:s.size,etag:'part-hash'}); },abort:async()=>{multipart.push('abort')}}) };
  const env = { DB, RESULTS, R2_ACCOUNT_ID:'test',R2_BOARDER_ACCESS_KEY_ID:'test-access',R2_BOARDER_SECRET_ACCESS_KEY:'test-secret',R2_BUCKET:'boarder' } as unknown as U.DirectEnv;
  const oldFetch = globalThis.fetch; let copies = 0;
  globalThis.fetch = async (input,init) => {
    copies++; const h = new Headers(init?.headers), url = new URL(String(input)), from = decodeURIComponent(h.get('x-amz-copy-source')!.split('/').slice(2).join('/'));
    const source = objects.get(from);assert.ok(source); assert.equal(h.get('x-amz-copy-source-if-match'), '"'+source.etag+'"');
    objects.set(decodeURIComponent(url.pathname.split('/').slice(2).join('/')), {...source});
    assert.equal(init?.body, undefined, 'Worker 요청에 파일 본문 없음');
    return new Response('<CopyObjectResult><ETag>copied</ETag></CopyObjectResult>');
  };
  return {env,sqlite,objects,multipart,get copies(){return copies}, close:()=>{globalThis.fetch=oldFetch;sqlite.close()}};
}
test('500MiB 딱 허용, 1바이트 초과·비정수·음수 거부, 빈 캔버스 파일 허용',async()=>{
 const t=setup();try {
  const s=await U.begin(t.env,'alice',{target:'files/test',size:U.MAX_FILE,mime:'application/octet-stream',metadata:{}});
  assert.equal(s.parts,63);assert.equal(s.size,524288000);
  for(const n of [U.MAX_FILE+1,-1,1.5,NaN]) await assert.rejects(U.begin(t.env,'alice',{target:'files/test',size:n,mime:'x',metadata:{}}));
  U.checkSize(0);
 }finally{t.close()}
});
test('작은 파일도 R2 PUT 서명, 길이·metadata·키 고정, 남의 세션 접근 거절',async()=>{
 const t=setup();try{
  const s=await U.begin(t.env,'file:alice',{target:'mfiles/id',size:4,mime:'image/png',metadata:{owner:'alice'}});
  const p=await U.part(t.env,'file:alice',s.id,1),url=new URL(p.url);
  assert.equal(url.hostname,'test.r2.cloudflarestorage.com');assert.match(url.pathname,/direct-pending/);assert.equal(p.headers['content-length'],'4');
  assert.match(url.searchParams.get('X-Amz-SignedHeaders')!,/content-length/);assert.equal(url.searchParams.get('X-Amz-Expires'),'900');
  await assert.rejects(U.part(t.env,'file:bob',s.id,1),{status:404});await assert.rejects(U.part(t.env,'file:alice',s.id,2),{status:400});
  assert.equal((await U.begin(t.env,'file:alice',{target:'mfiles/id',size:4,mime:'image/png',metadata:{owner:'alice'}})).id,s.id);
  assert.equal(t.copies,0);
 }finally{t.close()}
});
test('완료 전 파일 없음/크기 불일치 거부, 맞으면 서버 복사 한 번, 완료 재시도 멱등',async()=>{
 const t=setup();try{
  const s=await U.begin(t.env,'alice',{target:'files/x',size:4,mime:'x',metadata:{}});const row=await U.getSession(t.env,'alice',s.id);
  await assert.rejects(U.complete(t.env,'alice',s.id),{status:409});
  t.objects.set(row.source,{size:5,etag:'wrong'});await assert.rejects(U.complete(t.env,'alice',s.id),{status:413});assert.equal(t.objects.has(row.source),false);
  t.objects.set(row.source,{size:4,etag:'good'});let quota=0;
  await U.complete(t.env,'alice',s.id,[],async()=>{quota++});await U.complete(t.env,'alice',s.id,[],async()=>{quota++});
  assert.equal(quota,1);assert.equal(t.copies,1);assert.equal(t.objects.has('files/x'),true);assert.equal(t.objects.has(row.source),false);
 }finally{t.close()}
});
test('조각 누락 거부·큰 파일 500MiB 완료는 본문 메모리 할당 없이 확인',async()=>{
 const t=setup();try{
  const s=await U.begin(t.env,'alice',{target:'files/large',size:U.MAX_FILE,mime:'x',metadata:{}});
  await assert.rejects(U.complete(t.env,'alice',s.id,[]),{status:400});
  const pieces=Array.from({length:s.parts},(_,i)=>({partNumber:i+1,etag:'part'+i}));
  await U.complete(t.env,'alice',s.id,pieces);assert.equal(t.objects.get('files/large').size,U.MAX_FILE);assert.equal(t.multipart.length,1);
 }finally{t.close()}
});
test('취소·만료·중단된 완료 제어는 상태로 거부/복구',async()=>{
 const t=setup();try{
  const a=await U.begin(t.env,'alice',{target:'files/a',size:4,mime:'x',metadata:{}});await U.abort(t.env,'alice',a.id);
  await assert.rejects(U.part(t.env,'alice',a.id,1),{status:409});await assert.rejects(U.complete(t.env,'alice',a.id),{status:409});
  const b=await U.begin(t.env,'alice',{target:'files/b',size:4,mime:'x',metadata:{}});const row=await U.getSession(t.env,'alice',b.id);t.objects.set(row.source,{size:4,etag:'ok'});
  t.sqlite.prepare("UPDATE direct_upload SET state='completing',locked_at=? WHERE id=?").run(Date.now()-301000,b.id);
  await U.complete(t.env,'alice',b.id);assert.equal(t.objects.has('files/b'),true);
  t.sqlite.prepare('UPDATE direct_upload SET expires=0 WHERE id=?').run(b.id);await assert.rejects(U.part(t.env,'alice',b.id,1),{status:410});await U.sweep(t.env);
  assert.equal(t.sqlite.prepare('SELECT count(*) AS n FROM direct_upload WHERE id=?').get(b.id)!.n,0);assert.equal(t.objects.has('files/b'),true);
 }finally{t.close()}
});

test('정리 예산: terminal1000은 일괄, 미완료100은 반복 실행으로 drain · 진행 중 완료는 보존', async () => {
 const t=setup();try{
  const now=Date.now(), day=new Date(now).toISOString().slice(0,10);
  const insert=t.sqlite.prepare('INSERT INTO direct_upload(id,owner,source,target,size,mime,metadata,state,expires,charged_day,locked_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  const seed=(id:string,state:string,owner='canvas:test',charged:string|null=null,locked:number|null=null,expires=now-1)=>{
   insert.run(id,owner,'source/'+id,'published/'+id,4,'x','{}',state,expires,charged,locked);
   t.objects.set('source/'+id,{size:4,etag:'source'});
  };
  for(let i=0;i<1100;i++){ const id='terminal'+String(i).padStart(4,'0');seed(id,i<1050?'done':'aborted');t.objects.set('published/'+id,{size:4,etag:'published'}); }
  for(let i=0;i<210;i++)seed('pending'+String(i).padStart(4,'0'),'uploading');
  for(let i=0;i<5;i++)seed('refund'+i,'aborted','file:refund',day);
  t.sqlite.prepare('INSERT INTO user_pref(owner,k,v,at) VALUES (?,?,?,?)').run('refund','q:mfiles:'+day,JSON.stringify({n:5,b:20}),now);
  seed('fresh','completing','canvas:test',null,now);
  seed('future','uploading','canvas:test',null,null,now+3600000);
  let batches:number[]=[],single=0;
  const drop=t.env.RESULTS.delete.bind(t.env.RESULTS);
  (t.env.RESULTS as any).delete=async(keys:string|string[])=>{if(Array.isArray(keys))batches.push(keys.length);else single++;return drop(keys);};
  const count=()=>t.sqlite.prepare('SELECT count(*) n FROM direct_upload').get()!.n;
  for(const expected of [217,17,2]){
   batches=[];single=0;await U.sweep(t.env);assert.equal(count(),expected);
   assert.ok(batches.every(n=>n<=1000));assert.ok(single<=100,`미완료 source ${single}개`);
  }
  assert.deepEqual(JSON.parse((t.sqlite.prepare('SELECT v FROM user_pref WHERE owner=?').get('refund') as any).v),{n:0,b:0});
  assert.equal(t.objects.has('source/fresh'),true);assert.equal(t.objects.has('source/future'),true);
  assert.equal([...t.objects.keys()].filter(key=>key.startsWith('published/')).length,1100);
  t.sqlite.prepare('UPDATE direct_upload SET locked_at=? WHERE id=?').run(now-301000,'fresh');
  await U.sweep(t.env);assert.equal(count(),1);assert.equal(t.objects.has('source/fresh'),false);
 }finally{t.close()}
});

test('terminal source 일괄 삭제가 실패하면 DB 영수증을 남겨 다음 실행에서 다시 정리',async()=>{
 const t=setup();try{
  const a=await U.begin(t.env,'alice',{target:'files/kept',size:4,mime:'x',metadata:{}}),row=await U.getSession(t.env,'alice',a.id);
  t.objects.set(row.source,{size:4,etag:'source'});t.objects.set('files/kept',{size:4,etag:'published'});
  t.sqlite.prepare("UPDATE direct_upload SET state='done',expires=0 WHERE id=?").run(a.id);
  const drop=t.env.RESULTS.delete.bind(t.env.RESULTS);let fail=true;
  (t.env.RESULTS as any).delete=async(keys:string|string[])=>{if(fail){fail=false;throw new Error('R2 정리 실패');}return drop(keys);};
  await assert.rejects(U.sweep(t.env),/R2 정리 실패/);
  assert.equal(t.sqlite.prepare('SELECT count(*) n FROM direct_upload').get()!.n,1);
  await U.sweep(t.env);assert.equal(t.sqlite.prepare('SELECT count(*) n FROM direct_upload').get()!.n,0);
  assert.equal(t.objects.has(row.source),false);assert.equal(t.objects.has('files/kept'),true);
 }finally{t.close()}
});

test('정리 목록 뒤 완료가 먼저 잠그면 보존, 정리가 먼저 확보하면 늦은 완료 CAS 거절',async()=>{
 const t=setup();try{
  const a=await U.begin(t.env,'alice',{target:'files/race',size:4,mime:'x',metadata:{}}),row=await U.getSession(t.env,'alice',a.id);
  t.objects.set(row.source,{size:4,etag:'pending'});
  t.sqlite.prepare('UPDATE direct_upload SET expires=0 WHERE id=?').run(a.id);
  const prepare=t.env.DB.prepare.bind(t.env.DB);let raced=false;
  (t.env.DB as any).prepare=(sql:string)=>{
   const statement=prepare(sql);
   if(!sql.includes('SELECT * FROM direct_upload WHERE expires'))return statement;
   return {...statement,bind:(...args:any[])=>{
    const bound=statement.bind(...args);return {...bound,all:async()=>{
     const result=await bound.all();
     if(!raced){raced=true;t.sqlite.prepare("UPDATE direct_upload SET state='completing',locked_at=? WHERE id=?").run(Date.now(),a.id);}
     return result;
    }};
   }};
  };
  await U.sweep(t.env);
  assert.equal(t.objects.has(row.source),true);
  assert.equal(t.sqlite.prepare('SELECT count(*) n FROM direct_upload').get()!.n,1);
  t.sqlite.prepare('UPDATE direct_upload SET locked_at=? WHERE id=?').run(Date.now()-301000,a.id);
  const drop=t.env.RESULTS.delete.bind(t.env.RESULTS);let observed=false;
  (t.env.RESULTS as any).delete=async(keys:string|string[])=>{
   if(keys===row.source){
    observed=true;assert.equal((t.sqlite.prepare('SELECT state FROM direct_upload WHERE id=?').get(a.id) as any).state,'expired');
    assert.equal(t.sqlite.prepare("UPDATE direct_upload SET state='completing' WHERE id=? AND state='uploading' RETURNING id").get(a.id),undefined);
   }
   return drop(keys);
  };
  await U.sweep(t.env);assert.equal(observed,true);assert.equal(t.objects.has(row.source),false);
  assert.equal(t.sqlite.prepare('SELECT count(*) n FROM direct_upload').get()!.n,0);
 }finally{t.close()}
});

test('정리 목록 뒤 완료가 done까지 끝났다면 expired 전환·예약 환불 없이 terminal 정리',async()=>{
 const t=setup();try{
  const day=new Date().toISOString().slice(0,10), a=await U.begin(t.env,'file:alice',{target:'mfiles/race-done',size:4,mime:'x',metadata:{}}),row=await U.getSession(t.env,'file:alice',a.id);
  t.objects.set(row.source,{size:4,etag:'pending'});t.objects.set(row.target,{size:4,etag:'published'});
  t.sqlite.prepare('UPDATE direct_upload SET expires=0,charged_day=? WHERE id=?').run(day,a.id);
  t.sqlite.prepare('INSERT INTO user_pref(owner,k,v,at) VALUES (?,?,?,?)').run('alice','q:mfiles:'+day,JSON.stringify({n:1,b:4}),Date.now());
  const prepare=t.env.DB.prepare.bind(t.env.DB);let raced=false;
  (t.env.DB as any).prepare=(sql:string)=>{
   const statement=prepare(sql);if(!sql.includes('SELECT * FROM direct_upload WHERE expires'))return statement;
   return {...statement,bind:(...args:any[])=>{const bound=statement.bind(...args);return {...bound,all:async()=>{
    const result=await bound.all();if(!raced){raced=true;t.sqlite.prepare("UPDATE direct_upload SET state='done' WHERE id=?").run(a.id);}return result;
   }}}};
  };
  await U.sweep(t.env);
  assert.equal((t.sqlite.prepare('SELECT state FROM direct_upload WHERE id=?').get(a.id) as any).state,'done');
  await U.sweep(t.env);
  assert.equal(t.sqlite.prepare('SELECT count(*) n FROM direct_upload').get()!.n,0);
  assert.deepEqual(JSON.parse((t.sqlite.prepare('SELECT v FROM user_pref WHERE owner=?').get('alice') as any).v),{n:1,b:4});
  assert.equal(t.objects.has(row.target),true);assert.equal(t.objects.has(row.source),false);
 }finally{t.close()}
});


test('서명은 보더 전용 금고 이름만 읽고 설정 누락은 값 없이 거부', async () => {
 const env = {R2_ACCOUNT_ID:'test',R2_BOARDER_ACCESS_KEY_ID:'boarder-test-id',R2_BOARDER_SECRET_ACCESS_KEY:'boarder-test-secret'} as U.DirectEnv;
 const signed = await U.presign(env, 'GET', 'files/test');
 assert.match(new URL(signed.url).searchParams.get('X-Amz-Credential')!, /^boarder-test-id\//);
 for (const key of ['R2_BOARDER_ACCESS_KEY_ID','R2_BOARDER_SECRET_ACCESS_KEY'] as const) {
  await assert.rejects(U.presign({...env,[key]:undefined}, 'GET', 'files/test'), (e:any) => e.status === 503 && !e.message.includes('boarder-test'));
 }
 await assert.rejects(U.presign({R2_ACCOUNT_ID:'test',R2_ACCESS_KEY_ID:'old-test',R2_SECRET_ACCESS_KEY:'old-secret'} as unknown as U.DirectEnv, 'GET', 'files/test'), {status:503});
});

test('init의0093 누락만 준비안됨, 다른 테이블·과부하·일반DB오류는 그대로',()=>{
 for(const table of ['direct_upload','canvas_upload']){
  const wrapped=new Error('D1 execution failed',{cause:new Error('D1_ERROR: no such table: '+table+': SQLITE_ERROR')});
  const result=U.initializationError(wrapped) as any;assert.equal(result.status,503);assert.equal(result.code,'direct_upload_unavailable');
 }
 for(const error of [new Error('no such table: user'),new Error('D1_ERROR: overloaded'),new Error('network')])assert.equal(U.initializationError(error),error);
});
