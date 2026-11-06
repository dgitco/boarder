import assert from 'node:assert/strict';
import {mkdtempSync,openSync,closeSync,ftruncateSync,rmSync,openAsBlob} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {uploadDirect} from '../../../packages/cli/src/direct-upload.mjs';
const base=process.env.BOARDER_URL||'https://boarder.dgit.co',admin=process.env.BOARDER_ADMIN_TOKEN;
if(!admin)throw Error('BOARDER_ADMIN_TOKEN 환경변수가 필요합니다');
const realFetch=globalThis.fetch,rows=[],n=Date.now().toString(36),users=[`up-${n}-a@example.com`,`up-${n}-b@example.com`],cookies=[];
const scratch=mkdtempSync(join(tmpdir(),'boarder-direct-e2e-')),ids=[];
async function request(path,body,who=null){
 const raw=JSON.stringify(body),headers={'content-type':'application/json',...(who===null?{authorization:'Bearer '+admin}:{cookie:cookies[who],'x-hb':'1','sec-fetch-site':'same-origin'})};
 const r=await realFetch(base+path,{method:'POST',headers,body:raw});rows.push({host:new URL(base).host,path,method:'POST',body_bytes:Buffer.byteLength(raw),status:r.status});
 const j=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(Error(j.error||'제어 오류'),{status:r.status});return j;
}
async function file(blob,who,key,{interrupt=false}={}){
 let session;const counts={},control=async(action,body)=>{const j=await request('/api/upload/'+action,body,who);if(action==='init')session=j;return j;};
 let cut=false;
 globalThis.fetch=async(url,options)=>{
  const u=new URL(url);assert.ok(u.hostname.endsWith('.r2.cloudflarestorage.com'));assert.equal(options.credentials,'omit');assert.equal(options.headers.authorization,undefined);assert.equal(options.headers.cookie,undefined);
  options={...options,headers:{...options.headers,Origin:new URL(base).origin}};
  const part=Number(u.searchParams.get('partNumber')||1);counts[part]=(counts[part]||0)+1;
  if(interrupt&&part===2&&!cut){
   cut=true;const ac=new AbortController(),reader=options.body.stream().getReader();
   const slow=new ReadableStream({async pull(out){await new Promise(r=>setTimeout(r,5));const chunk=await reader.read();if(chunk.done)out.close();else out.enqueue(chunk.value);},cancel:r=>reader.cancel(r)});
   const timer=setTimeout(()=>ac.abort(),40);
   try{await realFetch(url,{...options,body:slow,duplex:'half',signal:ac.signal});throw Error('중단 시험이 끊기지 않았어요');}finally{clearTimeout(timer);rows.push({host:u.host,path:u.pathname,method:'PUT',part,body_bytes:options.body.size,result:'중간 중단'});}
  }
  if(!interrupt&&part===1){
   const origin=new URL(base).origin,pre=await realFetch(url,{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'PUT','Access-Control-Request-Headers':'content-type'}});
   assert.equal(pre.headers.get('access-control-allow-origin'),origin,'R2 CORS 허용 출처');
   const denied=await realFetch(url,{method:'OPTIONS',headers:{Origin:'https://not-boarder.example','Access-Control-Request-Method':'PUT'}});assert.notEqual(denied.headers.get('access-control-allow-origin'),'https://not-boarder.example');
   const bad=await realFetch(url,{...options,headers:{...options.headers,'Content-MD5':'AAAAAAAAAAAAAAAAAAAAAA=='}});assert.equal(bad.status,400,'R2가 틀린 Content-MD5를 거절해야 합니다');await bad.body?.cancel();
  }
  const r=await realFetch(url,options);if(r.ok)assert.match(r.headers.get('access-control-expose-headers')||'',/etag/i);rows.push({host:u.host,path:u.pathname,method:'PUT',part,body_bytes:options.body.size,status:r.status});return r;
 };
 try{
  const result=await uploadDirect(blob,{control,init:{key,name:'시험-'+key+'.bin',mime:'application/octet-stream',size:blob.size}});
  assert.ok(result.ok);ids.push({email:users[who],id:result.id,size:blob.size});
  if(interrupt){assert.equal(counts[1],1);assert.equal(counts[2],2);}
  const other=1-who,r=await realFetch(base+'/api/file/'+result.id,{headers:{cookie:cookies[other]}});assert.equal(r.status,404);await r.body?.cancel();
  await assert.rejects(request('/api/upload/part',{id:session.id,number:1},other),{status:404});
  const get=await realFetch(base+'/api/file/'+result.id+'?dl',{headers:{cookie:cookies[who]}});assert.equal(get.status,200);
  const hash=createHash('sha256');let bytes=0;for await(const chunk of get.body){bytes+=chunk.length;hash.update(chunk);}assert.equal(bytes,blob.size);
  const expected=createHash('sha256');for await(const chunk of blob.stream())expected.update(chunk);assert.equal(hash.digest('hex'),expected.digest('hex'));
  return result;
 }finally{globalThis.fetch=realFetch;}
}
try{
 for(const email of users){await request('/api/admin/invites',{email});const s=await request('/api/admin/test-session',{email});cookies.push(s.cookies.map(c=>c.name+'='+c.value).join('; '));}
 const small=await file(new Blob(['직접 R2 작은 파일']),1,'small');assert.ok(small.id);
 await assert.rejects(request('/api/upload/init',{key:'over',name:'초과.bin',mime:'application/octet-stream',size:524288001},0),{status:413});
 // 실제 500MiB 전송은 명시한 경우만 수행한다. 파일은 sparse 파일로 만들어 메모리에 통째로 담지 않는다.
 if(process.argv.includes('--boundary')){const path=join(scratch,'boundary.bin'),fd=openSync(path,'w');ftruncateSync(fd,524288000);closeSync(fd);await file(await openAsBlob(path),0,'boundary',{interrupt:true});}
 assert.ok(rows.filter(r=>r.host===new URL(base).host).every(r=>r.body_bytes<16384));
 console.log(JSON.stringify({ok:true,boundary:process.argv.includes('--boundary'),files:ids,requests:rows},null,2));
}finally{
 globalThis.fetch=realFetch;
 for(const email of users){await request('/api/admin/test-session',{email,revoke:true}).catch(()=>{});await request('/api/admin/invites',{email,remove:true}).catch(()=>{});}
 rmSync(scratch,{recursive:true,force:true});
 // 완료 파일은 운영 관리자가 files[].id로 기존 R2 mfiles/에서 지운다. 다른 회원 데이터는 건드리지 않는다.
}
