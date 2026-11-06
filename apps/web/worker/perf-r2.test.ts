import {test} from 'node:test';
import assert from 'node:assert/strict';
import {register} from 'node:module';
register('./test-hooks.mjs',import.meta.url);
const {meterEnv,newMeter}=await import('./perf.ts');
test('계측 감싸개는 R2 multipart 동기 핸들의 완료·취소 계약을 유지한다',async()=>{
 let complete=0,abort=0;
 const handle={complete:async()=>{complete++},abort:async()=>{abort++}};
 const env={DB:{} as D1Database,RESULTS:{resumeMultipartUpload(){return handle}} as unknown as R2Bucket};
 const metered=meterEnv(env,newMeter()),multipart=metered.RESULTS.resumeMultipartUpload('pending/key','upload-id');
 assert.equal(multipart,handle);await multipart.complete([]);await multipart.abort();assert.equal(complete,1);assert.equal(abort,1);
});
