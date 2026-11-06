import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('기존 탭의 모듈404는 초기 첨부만 호환, 세션 시작후·인증·네트워크 실패는 전환 금지',async()=>{
 const html=readFileSync(new URL('../board-template/page.html',import.meta.url),'utf8');
 const start=html.indexOf('const uploadModule = async () => {'),end=html.indexOf('\nasync function directAttachment',start);
 const source=html.slice(start,end).replace(/import\(["']\/direct-upload\.js["']\)/,'load()');
 const make=(fetch:Function,load:Function)=>new Function('fetch','load',source+'; return uploadModule;')(fetch,load);
 const error=new Error('module not available');const fail=async()=>{throw error;};let legacy=0;
 const loader=make(async()=>({status:404}),fail),shim=await loader();
 await shim.uploadDirect(new Blob(['x']),{legacy:async()=>{legacy++;}});assert.equal(legacy,1);
 assert.throws(()=>shim.uploadDirect(new Blob(['x']),{session:{id:'started'},legacy:()=>{legacy++;}}),e=>e===error);
 for(const status of [200,401,403,503])await assert.rejects(make(async()=>({status}),fail)(),e=>e===error);
 await assert.rejects(make(async()=>{throw new TypeError('offline');},fail)(),e=>e===error);
 let probed=false;const success={uploadDirect:()=>{}};
 assert.equal(await make(async()=>{probed=true;},async()=>success)(),success);assert.equal(probed,false);
});

test('미리보기 응답이 멈추거나 실패해도 원본 첨부 전송은 즉시 끝남',async()=>{
 const html=readFileSync(new URL('../board-template/page.html',import.meta.url),'utf8');
 const source=html.slice(html.indexOf('async function storeImagePreview('),html.indexOf('\nfunction preUp('));
 const upOne=html.slice(html.indexOf('async function upOne('),html.indexOf('\nfunction attChanged('));
 for(const outcome of ['404','offline']){
  let finish:Function=()=>{},started=false;
  const pending=new Promise((resolve,reject)=>{finish=()=>outcome==='404'?resolve({ok:false}):reject(new TypeError('offline'));});
  const make=new Function('fetch','makeImagePreview','uploadModule','upKey','AbortController','setTimeout','clearTimeout',
   source+'\n'+upOne+'; return {directAttachment,upOne};');
  const api=make(async()=>{started=true;return pending;},async()=>new Blob(['preview'],{type:'image/webp'}),
   async()=>({uploadDirect:async()=>({id:'original'})}),()=> 'stable-key',AbortController,setTimeout,clearTimeout);
  const a:any={f:{name:'photo.jpg',type:'image/jpeg',size:300000}};
  a.done=api.directAttachment(a);
  let timer:ReturnType<typeof setTimeout>;
  try{
   assert.equal(await Promise.race([api.upOne(a),new Promise(resolve=>{timer=setTimeout(()=>resolve('blocked'),100);})]),'original');
   assert.equal(started,true);
  }finally{clearTimeout(timer!);finish();await a.previewDone;}
  assert.equal(a.id,'original');assert.equal(a.err,false);assert.equal(!!a.previewStored,false);
 }
});
