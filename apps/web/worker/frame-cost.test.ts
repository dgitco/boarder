import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext, Script} from 'node:vm';
const source=readFileSync(new URL('./legacy/shell.js',import.meta.url),'utf8');
const start=source.lastIndexOf('(() => {\n  if (!window.HB_LIVE) return;', source.indexOf('  // 노드 트리 그리기:')),stop=source.indexOf('  // 노드 트리 그리기:',start);
assert.ok(start>=0 && stop>start);
const setup=(options:{hidden?:boolean,supported?:boolean,observeFails?:boolean}={})=>{
 let now=0,hidden=!!options.hidden;
 const events:any[]=[],timers:{fn:Function,ms:number}[]=[],observers:any[]=[],listeners=new Map<string,Function[]>();
 const on=(type:string,fn:Function)=>listeners.set(type,[...(listeners.get(type)||[]),fn]);
 class Observer{
  static supportedEntryTypes=options.supported===false?['longtask']:['long-animation-frame','longtask'];
  kind='';pending:any[]=[];
  constructor(public callback:Function){observers.push(this);}
  observe({type}:{type:string}){if(options.observeFails&&type==='long-animation-frame')throw new Error('unsupported');this.kind=type;}
  takeRecords(){const result=this.pending;this.pending=[];return result;}
 }
 const context:any={performance:{now:()=>now,getEntriesByType:()=>[],getEntriesByName:()=>[]},navigator:{},
  document:{get hidden(){return hidden;},hasFocus:()=>true,readyState:'loading',addEventListener:on},
  addEventListener:on,setInterval:(fn:Function,ms:number)=>timers.push({fn,ms}),requestAnimationFrame:()=>{},fetch:()=>Promise.resolve(),
  matchMedia:()=>({matches:true}),location:{href:'https://boarder.dgit.co/chat/private-person?text=secret',origin:'https://boarder.dgit.co'},
  URL,PerformanceObserver:Observer,HB_LIVE:true,HB_VER:'test-harness',SHELL_VER:'test-shell',CS:{th:null},
  posthog:{capture:(event:string,props:any)=>events.push({event,...JSON.parse(JSON.stringify(props))})},
  openChan:function(this:any,...args:any[]){now+=10;return {thisValue:this,arg:args[0]};},
  openThread:()=>{now+=15;return Promise.resolve('same-promise');},cardRows:()=>{now+=20;return ['same-card'];},viewChat:()=>{now+=25;return 'same-view';}};
 context.window=context;
 runInNewContext(source.slice(start,stop)+'\n})();',context);
 const emit=(type:string)=>{for(const fn of listeners.get(type)||[])fn({target:{matches:()=>false}});};
 const loaf=()=>observers.find(x=>x.kind==='long-animation-frame');
 return {context,events,timers,observers,setTime:(n:number)=>{now=n;},getTime:()=>now,
  hide:(value:boolean)=>{hidden=value;emit('visibilitychange');},emit,
  deliver:(entries:any[])=>loaf().callback({getEntries:()=>entries}),queue:(entries:any[])=>loaf().pending.push(...entries),
  flush:()=>{timers.find(t=>t.ms===300000)!.fn();return events.filter(x=>x.action==='idle_cost').at(-1);},
  minute:()=>timers.find(t=>t.ms===60000)!.fn()};
};
const frame=(startTime:number,duration=180,extra:any={})=>({startTime,duration,blockingDuration:120,scripts:[],...extra});

test('전체 shell 구문과 기존 보고 주기·observer 수를 유지',()=>{
 new Script(source);
 const s=setup();assert.deepEqual(s.timers.map(x=>x.ms),[60000,300000]);
 assert.deepEqual(s.observers.map(x=>x.kind),['long-animation-frame','longtask']);
 for(let n=1;n<=3;n++){s.setTime(n*300000);s.flush();}
 assert.equal(s.events.length,3);assert.ok(s.events.every(x=>x.action==='idle_cost'));
});

test('보이는 시간은 숨김 전환·지연된 타이머를 실제 구간으로 셈하고 보고 후 초기화',()=>{
 const s=setup();s.setTime(100000);s.hide(true);s.setTime(200000);s.hide(false);s.setTime(300000);
 let out=s.flush();assert.equal(out.visible_ms,200000);assert.equal(out.observed_ms,300000);
 assert.equal(out.lf_supported,true);assert.equal(out.lf_complete,true);
 assert.deepEqual([out.lf_channel,out.lf_thread,out.lf_cards,out.lf_scroll,out.lf_other],[0,0,0,0,0]);assert.equal(out.lf_top,null);
 s.hide(true);s.setTime(900000);out=s.flush();assert.equal(out.visible_ms,0);assert.equal(out.observed_ms,600000);
 s.hide(false);s.setTime(1200000);out=s.flush();assert.equal(out.visible_ms,300000);assert.equal(out.observed_ms,300000);
 const hidden=setup({hidden:true});hidden.setTime(300000);assert.equal(hidden.flush().visible_ms,0);
});

test('채널·스레드·카드·스크롤·기타는 실제 실행 구간의 배타적 건수, 비동기 반환도 보존',async()=>{
 const s=setup(),c=s.context,owner={private:'do not capture'};
 s.setTime(100);const answer=c.openChan.call(owner,'private-channel');assert.equal(answer.thisValue,owner);assert.equal(answer.arg,'private-channel');
 s.setTime(1000);c.cardRows();
 s.setTime(2000);const pending=c.openThread('private-thread');assert.equal(await pending,'same-promise');
 s.setTime(3000);c.CS.th={ts:'private-message'};assert.equal(c.viewChat(),'same-view');
 s.setTime(4000);s.emit('scroll');
 s.deliver([frame(100,160),frame(1995,150),frame(995,150),frame(2995,150),frame(3990,150),frame(5000,150),frame(5500,149)]);
 s.setTime(300000);let out=s.flush();
 assert.deepEqual([out.lf_channel,out.lf_thread,out.lf_cards,out.lf_scroll,out.lf_other],[1,2,1,1,1]);
 assert.ok(!JSON.stringify(out).includes('private'));
 s.setTime(600000);out=s.flush();assert.deepEqual([out.lf_channel,out.lf_thread,out.lf_cards,out.lf_scroll,out.lf_other],[0,0,0,0,0]);
});

test('observer 전달 때의 보임 여부 대신 프레임 전체 구간의 보임 여부를 사용',()=>{
 const s=setup();s.setTime(1000);s.hide(true);s.setTime(2000);s.hide(false);
 s.deliver([frame(100,200),frame(900,200),frame(1100,200),frame(1900,200),frame(2100,200)]);
 s.setTime(300000);let out=s.flush();assert.equal(out.lf_other,2);assert.equal(out.visible_ms,299000);
 s.setTime(300100);s.hide(true);s.deliver([frame(299500,200)]);s.setTime(600000);out=s.flush();assert.equal(out.lf_other,0,'이미 보고한 구간의 늦은 항목을 다음 구간으로 섞지 않음');
});

test('보고 전에 takeRecords를 비워 경계 항목을 한 번만 세고 기존 분 요약도 보존',()=>{
 const s=setup();s.queue([frame(299700,200)]);s.setTime(300000);const out=s.flush();assert.equal(out.lf_other,1);
 s.minute();const old=s.events.find(x=>x.action==='long_frame');assert.equal(old.n,1);assert.equal(old.ms,200);
 s.setTime(600000);assert.equal(s.flush().lf_other,0);s.minute();assert.equal(s.events.filter(x=>x.action==='long_frame').length,1);
});

test('LoAF 미지원·등록 실패는 0건으로 위장하지 않고 지원 여부와 null을 보고',()=>{
 for(const options of [{supported:false},{observeFails:true}]){
  const s=setup(options);s.setTime(300000);const out=s.flush();assert.equal(out.visible_ms,300000);assert.equal(out.lf_supported,false);assert.equal(out.lf_complete,false);
  for(const key of ['lf_channel','lf_thread','lf_cards','lf_scroll','lf_other','lf_top'])assert.equal(out[key],null);
 }
});

test('상위 원인은 반올림 전 blocking으로 한 개만 선택, 개인 문자열은 허용하지 않음',()=>{
 const s=setup(),asset='a'.repeat(32)+'.js';
 const scripts=[{duration:30,forcedStyleAndLayoutDuration:12,sourceFunctionName:'privateCustomerName',invokerType:'private-event',invoker:'IMG#private.onload',sourceURL:'https://boarder.dgit.co/privateCustomer?text=secret'},
  {duration:50,forcedStyleAndLayoutDuration:20,sourceFunctionName:'viewChat',invokerType:'resolve-promise',sourceURL:'https://boarder.dgit.co/bxs/'+asset}];
 s.deliver([frame(100,250,{blockingDuration:150.4,scripts}),frame(500,400,{blockingDuration:150.3,scripts:[{...scripts[0],duration:300}]})]);
 s.setTime(300000);const out=s.flush();assert.equal(out.lf_top.ms,250);assert.equal(out.lf_top.fn,'viewChat');assert.equal(out.lf_top.src,asset);assert.equal(out.lf_top.layout_ms,20);
 assert.ok(!JSON.stringify(out).includes('private'));assert.ok(!JSON.stringify(out).includes('secret'));
 assert.ok(JSON.stringify(out.lf_top).length<250);
});

test('pagehide·pageshow와 오래된 가시성 이력은 노출시간을 꾸미지 않음',()=>{
 const s=setup();s.setTime(1000);s.emit('pagehide');s.setTime(10000);s.emit('pageshow');s.setTime(300000);assert.equal(s.flush().visible_ms,291000);
 const crowded=setup();for(let n=1;n<=1025;n++){crowded.setTime(n*1000);crowded.hide(n%2===1);}
 crowded.hide(false);crowded.deliver([frame(1,150)]);crowded.setTime(1200000);assert.equal(crowded.flush().lf_complete,false);
 crowded.setTime(1500000);assert.equal(crowded.flush().lf_complete,true);
});
