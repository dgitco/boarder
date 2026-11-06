import {test} from 'node:test';
import assert from 'node:assert/strict';
import {uploadDirect} from './direct-upload.mjs';

test('모든 바이트는 R2 PUT, 인증은 제어에만, 실패한 조각만 재시도', async () => {
  const old = globalThis.fetch, calls = [], controls = [], session = {id:'test',size:12,partSize:4,parts:3}; let second = 0;
  globalThis.fetch = async (url, opts) => {
    const number = Number(new URL(url).searchParams.get('part'));
    calls.push(number); assert.equal(opts.credentials,'omit');assert.equal(opts.headers.authorization,undefined);assert.equal(opts.headers.cookie,undefined);assert.equal(opts.body.size,4);
    if (number === 2 && second++ === 0) return new Response('',{status:503});
    return new Response('',{headers:{etag:'"etag'+number+'"'}});
  };
  try {
    const out = await uploadDirect(new Blob(['abcdefghijkl']),{session,control:async(action,body)=>{
      controls.push({action,body});
      if(action==='part') return {url:'https://test.r2.cloudflarestorage.com/pending?part='+body.number,headers:{'content-length':'4'}};
      assert.equal(action,'complete');assert.deepEqual(body.parts.map(p=>p.etag),['etag1','etag2','etag3']);return {ok:true,id:'final'};
    }});
    assert.equal(out.id,'final');assert.deepEqual(calls,[1,2,2,3]);assert.ok(controls.every(c=>JSON.stringify(c.body).length<300));
  } finally {globalThis.fetch=old;}
});
test('연결이 끊긴 뒤에는 받은 조각을 보존해 같은 세션으로 이어 올린다',async()=>{
 const old=globalThis.fetch, session={id:'retry',size:8,partSize:4,parts:2},calls=[];let offline=true;
 globalThis.fetch=async(url)=>{const n=Number(new URL(url).searchParams.get('part'));calls.push(n);if(n===2&&offline)throw Error('offline');return new Response('',{headers:{etag:'"p'+n+'"'}})};
 const control=async(action,body)=>action==='part'?{url:'https://test.r2.cloudflarestorage.com/x?part='+body.number,headers:{}}:{ok:true};
 try{await assert.rejects(uploadDirect(new Blob(['abcdefgh']),{session,control}),/offline/);assert.equal(session.uploaded.length,1);offline=false;await uploadDirect(new Blob(['abcdefgh']),{session,control});assert.deepEqual(calls,[1,2,2,2,2]);}finally{globalThis.fetch=old}
});
test('명시적 취소는 서버 정리,500MiB 넘는 선언은 요청 없이 거절',async()=>{
 const controller=new AbortController();controller.abort();const actions=[];
 await assert.rejects(uploadDirect(new Blob(['a']),{session:{id:'cancel',size:1,partSize:1,parts:1},signal:controller.signal,control:async a=>{actions.push(a);return {}}}));
 assert.deepEqual(actions,['abort']);
 await assert.rejects(uploadDirect({size:524288001},{control:async()=>{throw Error('요청하면 안 됨')}}),/500MB/);
});

test('새 업로더는 init 지원 없음·설정 누락에만 옛 길로, 세션 시작 뒤에는 전환 안 함', async () => {
 const blob=new Blob(['abc']);let fallbacks=0;
 for(const error of [400,404,405,410,415,501].map(status=>({status})).concat([{status:503,code:'direct_upload_unavailable'}])) {
  const result=await uploadDirect(blob,{control:async()=>{throw error;},legacy:async()=>{fallbacks++;return {id:'legacy'};}});
  assert.equal(result.id,'legacy');
 }
 assert.equal(fallbacks,7);
 for(const error of [{status:401},{status:403},{status:413},{status:503},new TypeError('network')]) {
  await assert.rejects(uploadDirect(blob,{control:async()=>{throw error;},legacy:async()=>{throw Error('fallback 금지');}}), e=>e===error);
 }
 await assert.rejects(uploadDirect(blob,{session:{id:'started',size:3,parts:1,partSize:3},control:async()=>{throw {status:404};},legacy:async()=>{throw Error('fallback 금지');}}),e=>e.status===404);
});

test('code 있는 400(새 Worker 입력 오류)은 옛 길로 안 감 — 옛 Worker 의 code 없는 400 만', async () => {
 const blob=new Blob(['abc']);
 await assert.rejects(uploadDirect(blob,{control:async()=>{throw {status:400,code:'direct_upload_rejected'};},legacy:async()=>{throw Error('fallback 금지');}}),e=>e.status===400);
 const r=await uploadDirect(blob,{control:async()=>{throw {status:400};},legacy:async()=>({id:'legacy'})}); assert.equal(r.id,'legacy');
});
