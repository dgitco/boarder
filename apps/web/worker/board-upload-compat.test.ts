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
