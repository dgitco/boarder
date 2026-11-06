import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const shell=readFileSync(new URL('./legacy/shell.js',import.meta.url),'utf8');
const source=shell.slice(shell.indexOf('  async function apply(){'),shell.indexOf("  addEventListener('popstate', apply);"));
function setup(channel:string,mainOnly:boolean){
 let hash='#chat/'+channel;
 const opened:string[]=[],events:string[]=[];
 const ctx:any={window:{},on:()=>true,backing:0,applying:0,G:0,S:{ib:null},CH:['primary'],cur:null,CS:{th:null},
  HBR:{hash:()=>hash,same:(a:string,b:string)=>a===b},history:{state:null,replaceState:(_a:unknown,_b:unknown,h:string)=>{hash=h}},
  R:{classList:{remove:()=>{}}},URLSearchParams,decodeURIComponent,MVv:()=>false,agClose:()=>{},ibClose:()=>{},
  mainOnly:()=>mainOnly,isXCh:(k:string)=>/^x_[a-z0-9]{6,40}$/.test(k),chatMode:()=>!!ctx.cur,
  openChan:async(k:string)=>{opened.push(k);await Promise.resolve();ctx.cur={chan:mainOnly&&k!=='x_human1'?'primary':k};events.push('opened')},
  sync:()=>events.push('sync'),want:()=>ctx.cur?'#chat/'+ctx.cur.chan:'',recLater:()=>events.push('record')};
 vm.runInNewContext(source,ctx);
 return {ctx,opened,events,hash:()=>hash};
}
test('옛 자동공유채널·영역 링크를 메인 전용 정책에 보내고, 비동기 열기가 끝난 뒤 메인 주소를 기록',async()=>{
 for(const channel of ['x_agent1','harness','company']){
  const t=setup(channel,true);await t.ctx.apply();
  assert.deepEqual(t.opened,[channel]);assert.equal(t.ctx.cur.chan,'primary');assert.equal(t.hash(),'#chat/primary');
  assert.deepEqual(t.events,['opened','sync','record']);
 }
});
test('사람이 연 공유채널은 메인 전용·일반 회원 모두 원래 채널을 유지',async()=>{
 for(const mode of [true,false]){
  const t=setup('x_human1',mode);await t.ctx.apply();
  assert.deepEqual(t.opened,['x_human1']);assert.equal(t.ctx.cur.chan,'x_human1');assert.equal(t.hash(),'#chat/x_human1');
 }
});
test('일반 회원의 모르는 채널은 기존 보기로 돌아가고, 메인 링크는 그대로 연다',async()=>{
 const missing=setup('missing',false);missing.ctx.current='tree';await missing.ctx.apply();
 assert.deepEqual(missing.opened,[]);assert.equal(missing.hash(),'#tree');
 const main=setup('primary',true);await main.ctx.apply();assert.deepEqual(main.opened,['primary']);assert.equal(main.ctx.cur.chan,'primary');
});
