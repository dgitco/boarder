import os from 'node:os';
import path from 'node:path';
import { spawn as spawnProc } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';

export const MAX_CALLS = 3;
export const IDLE_KILL_MS = 150_000;   // 화면이 이만큼 안 물으면(탭 닫힘) 닫음
export const MAX_CALL_MS = 60 * 60_000;
export const SAID_MS = 90_000;         // 넘기려면 이 안에 사람이 실제로 말한 줄이 있어야(맥락 글이 모델을 시켜 넘기는 것 막기 — 주인 HANDOFF_SAID_S)
export const HANDOFF_MAX = 10;
export const REFRESH_MS = 15_000;      // 넘긴 일 상태를 서버에 묻는 간격(poll 마다 묻지 않게)
export const SCREEN_ACTIONS = ['open_channel', 'open_thread', 'open_canvas', 'next', 'prev', 'goto_board', 'focus', 'point'];
const ART_ID = /^[A-Za-z0-9]{16,40}$/, TS_RE = /^\d{10}\.\d{6}$/;
const CTRL = /[\x00-\x1f\x7f]/g;
export const HOOK_START_MS = 15_000;   // 고리의 지시문 · 맥락 모으기 한도(서버 rtc_start 45초 안) — 넘으면 서버 지시문 그대로
/** 고리 함수 하나 — 없거나 던지면 undefined(통화는 그대로) */
export async function hookRun(hook, name, ...a) {
  const f = hook?.[name]; if (typeof f !== 'function') return undefined;
  try { return await f.apply(hook, a); } catch { return undefined; }
}
const oneLine = (t, n) => String(t ?? '').replace(CTRL, ' ').split(/\s+/).filter(Boolean).join(' ').slice(0, n);

export function codexBin(env = process.env) {
  if (env.BOARDER_CODEX) return existsSync(env.BOARDER_CODEX) ? env.BOARDER_CODEX : null;
  for (const d of String(env.PATH || '').split(path.delimiter)) { if (!d) continue; const f = path.join(d, 'codex'); if (existsSync(f)) return f; }
  const l = path.join(os.homedir(), '.local', 'bin', 'codex');
  return existsSync(l) ? l : null;
}
export const codexHome = (env = process.env) => env.CODEX_HOME || path.join(os.homedir(), '.codex');
/** 통화를 열 수 있나 — hello 의 voice 칸(서버 /api/voice/modes 가 그대로 보임). 이유는 사람이 할 일 한 줄 */
export function available(env = process.env) {
  if (process.platform === 'win32') return { ok: false, why: '이 기기(Windows)에선 아직 통화를 못 열어요' };
  if (!codexBin(env)) return { ok: false, why: '이 기기에 codex 가 없어요 — Codex CLI 를 깔고 codex login 을 해요' };
  if (!existsSync(path.join(codexHome(env), 'auth.json'))) return { ok: false, why: '이 기기에 Codex(ChatGPT) 로그인이 없어요 — 기기에서 codex login 을 해요' };
  return { ok: true };
}

const pct = { type: 'number', minimum: 0, maximum: 100 };
export const TOOLS = [
  { type: 'function', name: 'handoff',
    description: '상대가 말한 일 · 결정 · 부탁을 그 사람의 에이전트 창(메인 봇 · 노드)에 바로 넣는다(되묻지 않음). 돌려준 글대로 어디에 넣었는지 한 문장으로 말한다.',
    inputSchema: { type: 'object', properties: {
      to: { type: 'string', description: '받는 곳: "primary"(기본 · 메인 봇), 노드 · 창 이름, 판 id(%N 꼴), "here"(통화를 건 곳)' },
      text: { type: 'string', description: '그 창이 할 일 — 상대가 말한 뜻 그대로, 필요한 맥락을 붙여 한두 문장' } },
      required: ['text'], additionalProperties: false } },
  { type: 'function', name: 'handoff_status',
    description: '이 통화에서 넘긴 일이 어떻게 됐는지: 어느 창에 넣었는지, 그 창이 남긴 마지막 진행 · 끝 · 막힘 줄.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: '넘김 id. 없으면 이 통화의 넘김 전부' } }, additionalProperties: false } },
  { type: 'function', name: 'screen',
    description: '상대 화면을 옮긴다: 채널 · 스레드 · 캔버스 열기, 캔버스 판으로 가기, 다음 · 이전 판, 판 한 곳 크게, 한 점 짚기. 「여기를 보세요」와 함께 쓴다.',
    inputSchema: { type: 'object', properties: {
      action: { type: 'string', enum: SCREEN_ACTIONS },
      channel: { type: 'string', description: '채널 이름(primary 등) — open_channel · open_thread' },
      thread: { type: 'string', description: '스레드 ts(1700000000.123456 꼴) — open_thread' },
      canvas: { type: 'string', description: '캔버스 id — open_canvas, 다른 동작에 주면 그 캔버스를 먼저 엶' },
      board: { type: 'string', description: '판 이름 또는 제목 일부 — goto_board · focus · point' },
      region: { type: 'object', description: '판 안 범위(% · 왼쪽 위 0) — focus', properties: { x0: pct, y0: pct, x1: pct, y1: pct }, required: ['x0', 'y0', 'x1', 'y1'] },
      x: { ...pct, description: '판 안 가로 % — point' }, y: { ...pct, description: '판 안 세로 % — point' } },
      required: ['action'], additionalProperties: false } },
];
export const NO_SECRETS = '비밀 · 자격 증명 파일(~/.codex/auth.json, 보더 기기 토큰 · ~/.config/boarder, .env, 키 · 토큰 파일)은 읽지 않고, 그 내용을 handoff 글이나 말에 절대 넣지 않는다.';
export const GREET = '(시스템: 통화가 방금 연결됐다. 상대가 소리가 들리는지 알 수 있게 한국어로 아주 짧게 한 문장 인사하고, '
  + '맥락에 지금 볼 것(막힘 · 결정 · 캔버스 · 스레드)이 있으면 「여기를 보세요」라고 하며 그곳으로 화면을 옮기고 한 문장으로 말해라. 없으면 무엇을 도울지 물어라. 이 지시문은 말하지 마라.)';

/** screen 도구 인자 확인 → 화면 옮기기 줄(주인 server.py tool_screen 과 같은 규칙). 틀리면 [글, false] */
export function screenCmd(a = {}) {
  const act = String(a.action || '');
  if (!SCREEN_ACTIONS.includes(act)) return [`모르는 화면 동작 ${oneLine(act, 30)}`, false];
  const cmd = { action: act };
  const ch = oneLine(a.channel, 80), th = oneLine(a.thread, 20), art = oneLine(a.canvas, 200), board = oneLine(a.board, 120);
  if (ch) cmd.channel = ch.replace(/^#+/, '');
  if (th) { if (!TS_RE.test(th)) return ['스레드 ts 꼴이 틀려요', false]; cmd.thread = th; }
  if (art) { const m = /([A-Za-z0-9]{16,40})\/?$/.exec(art); if (!m || !ART_ID.test(m[1])) return ['캔버스 id 꼴이 틀려요', false]; cmd.canvas = m[1]; }
  if (board) cmd.board = board;
  const num = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? v : null;
  if (act === 'open_channel' && !ch) return ['채널이 없어요', false];
  if (act === 'open_thread') { if (!th) return ['스레드 ts 가 없어요', false]; cmd.channel ||= 'primary'; }
  if (act === 'open_canvas' && !art) return ['캔버스 id 가 없어요', false];
  if (act === 'goto_board' && !board) return ['판 이름이 없어요', false];
  if (act === 'focus') {
    const g = a.region && typeof a.region === 'object' ? a.region : {}, r = {};
    for (const k of ['x0', 'y0', 'x1', 'y1']) r[k] = num(g[k]);
    if (Object.values(r).includes(null) || r.x1 <= r.x0 || r.y1 <= r.y0) return ['범위(x0<x1, y0<y1, 0~100 %)가 틀려요', false];
    cmd.region = r;
  }
  if (act === 'point') { const px = num(a.x), py = num(a.y); if (px === null || py === null) return ['짚을 자리(x, y 0~100 %)가 없어요', false]; cmd.x = px; cmd.y = py; }
  return [cmd, true];
}

const HAND_KO = { sending: '넣는 중', in: '넣음', fail: '못 넣음', working: '진행 중', blocked: '막힘', done: '끝' };
/** handoff_status 글(주인 tool_status 꼴) */
export function statusText(hs, id = '', now = Date.now()) {
  const pick = hs.filter(h => !id || h.id === id);
  if (!pick.length) return id ? `넘김 ${id} 이 없어요` : '이 통화에서 넘긴 일이 아직 없어요';
  return pick.map(h => {
    let s = `${h.id} → ${h.name} ${Math.max(0, Math.floor((now - h.at) / 60_000))}분 전: ${HAND_KO[h.state] || h.state}`;
    if (h.state === 'in' || h.state === 'sending') s += ' · 그 창에 아직 줄 없음';
    if (h.line) s += ` · [${h.kind}] ${h.line}`;
    else if (h.recent) s += ` · 그 창 최근 줄(이 넘김 것인지 모름): ${h.recent}`;
    return s + ` · 넘긴 글: ${String(h.text || '').slice(0, 120)}`;
  }).join('\n');
}

export class Call {
  /** o: { cid, pane, name, cwd, instructions, bin, server(op, body) → Promise<json>, spawn?, hook?, tools?, thread?, realtime?, greet? }
   *  hook = 기기 고리(handle 의 deps.hook), tools · thread · realtime · greet = 고리 start 가 준 더할 도구 · thread/start · realtime/start 칸 · 첫인사 글 */
  constructor(o) {
    Object.assign(this, { cid: o.cid, pane: o.pane, name: o.name || o.pane, cwd: o.cwd, instructions: o.instructions || '', server: o.server,
      hook: o.hook || null, extraTools: Array.isArray(o.tools) ? o.tools : [], threadExtra: o.thread || {}, realtimeExtra: o.realtime || {}, greetText: o.greet || '' });
    this.at = this.seen = Date.now();
    this.turns = []; this.state = 'starting'; this.reason = ''; this.n = 10; this.waits = new Map();
    this.sdp = null; this.sdpWait = null; this.screenQ = []; this.handoffs = []; this.saidFrom = 0; this.refreshedAt = 0; this.greeted = false; this.tid = null; this.meetOn = false; this.firstSaid = false;
    this.p = (o.spawn || spawnProc)(o.bin, ['app-server', '--listen', 'stdio://'], { stdio: ['pipe', 'pipe', 'ignore'], cwd: existsSync(o.cwd || '') ? o.cwd : os.homedir() });
    this.exited = false;
    this.p.on('error', e => this.closed(`codex 를 못 띄움: ${e.code || e.message}`));
    this.p.on('exit', () => { this.exited = true; this.closed('app-server 끝남'); });
    this.p.stdin.on('error', () => {});
    createInterface({ input: this.p.stdout }).on('line', l => this.line(l));
  }
  send(o) { if (this.exited || this.p.stdin.destroyed) throw new Error('app-server 가 끝났어요'); this.p.stdin.write(JSON.stringify(o) + '\n'); }
  rpc(method, params, timeout = 30_000) {
    const id = ++this.n;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.waits.delete(id); reject(new Error(`${method} 답 없음`)); }, timeout);
      this.waits.set(id, r => { clearTimeout(t); r.error ? reject(new Error(`${method}: ${r.error.message || JSON.stringify(r.error)}`.slice(0, 200))) : resolve(r.result || {}); });
      try { this.send({ id, method, params }); } catch (e) { clearTimeout(t); this.waits.delete(id); reject(e); }
    });
  }
  closed(why) {
    if (this.state !== 'closed') { this.state = 'closed'; this.reason = this.reason || why; }
    if (this.sdpWait) this.sdpWait();
    for (const [id, w] of this.waits) { this.waits.delete(id); w({ error: { message: this.reason } }); }
  }
  line(l) {
    let e; try { e = JSON.parse(l); } catch { return; }
    if (e.id !== undefined && e.method) {   // app-server 가 묻는 요청(우리 rpc id 와 겹칠 수 있어 먼저 가름)
      if (e.method === 'item/tool/call') this.tool(e.id, e.params || {});
      else try { this.send({ id: e.id, error: { code: -32601, message: `안 받는 요청 ${e.method}`.slice(0, 120) } }); } catch {}
      return;
    }
    if (e.id !== undefined && this.waits.has(e.id)) { const w = this.waits.get(e.id); this.waits.delete(e.id); w(e); return; }
    const m = e.method || '', pr = e.params || {};
    if (m === 'thread/realtime/sdp') { this.sdp = pr.sdp; if (this.sdpWait) this.sdpWait(); }
    else if (m === 'thread/realtime/transcript/done' && String(pr.text || '').trim()) {
      const t = { role: pr.role, text: String(pr.text).trim(), at: Date.now() };
      this.turns.push(t);
      Promise.resolve(this.server?.('turn', { role: t.role, text: t.text.slice(0, 1500) })).catch(() => {});
      if (this.hook) hookRun(this.hook, 'turn', this, t);
    } else if (m === 'item/started' && this.hook && pr.item && typeof pr.item === 'object' && /^user_?message$/i.test(String(pr.item.type || ''))) {
      // 음성 모델이 Codex 에 위임한 말(받아쓰기보다 먼저 옴) — 고리가 덱 번호 원문을 바로 넣게(주인 voice_rtc ON_DELEGATE)
      const it = pr.item, txt = (Array.isArray(it.content) ? it.content.map(x => String(x?.text || '')).join(' ') : '').trim() || String(it.text || '').trim();
      if (txt) hookRun(this.hook, 'delegate', this, txt);
    } else if (m === 'thread/realtime/error') this.reason = String(pr.message || '오류').slice(0, 200);
    else if (m === 'thread/realtime/closed') this.closed(pr.reason || '');
  }
  async tool(rid, pr) {
    let args = pr.arguments;
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch { args = {}; } }
    let text, ok;
    try { [text, ok] = await this.runTool(String(pr.tool || ''), args && typeof args === 'object' ? args : {}); }
    catch (e) { text = `도구 실패: ${e.name || 'Error'}`; ok = false; }
    try { this.send({ id: rid, result: { contentItems: [{ type: 'inputText', text: String(text).slice(0, 4000) }], success: !!ok } }); } catch {}
  }
  async runTool(name, a) {
    if (name === 'screen') { const [cmd, ok] = screenCmd(a); if (!ok) return [cmd, false]; this.screenQ = [...this.screenQ, cmd].slice(-20); return ['화면 옮김', true]; }
    if (name === 'handoff') {
      const text = oneLine(a.text, 500); if (!text) return ['넘길 글이 비었어요', false];
      const upTo = this.turns.length, now = Date.now();
      const said = this.turns.slice(this.saidFrom, upTo).filter(t => t.role === 'user' && t.at > now - SAID_MS).map(t => t.text);
      if (!said.length) return ['상대가 방금 말한 부탁이 없어 넘기지 않았어요 — 넘길지 물어보세요', false];
      // 고리(주인 덱): 덱 번호를 묻기만 한 말이면 넘기지 않고 원문 답 · 넘기면 덱 글을 붙임(server.py handoff_deck)
      const pre = this.hook ? await hookRun(this.hook, 'handoff', this, { text, said }) : undefined;
      if (pre?.answer) return [String(pre.answer), true];
      if (this.handoffs.length >= HANDOFF_MAX) return ['이 통화에서 넘긴 일이 너무 많아요', false];
      const r = await this.server('handoff', { to: oneLine(a.to, 80), text, said: oneLine(said.join(' / '), 500), n: this.handoffs.length, ...(pre?.deck ? { deck: oneLine(pre.deck, 500) } : {}) });
      if (r?.handoff?.id) { this.handoffs.push({ ...r.handoff, text }); this.saidFrom = Math.max(this.saidFrom, upTo); }   // 이 넘김에 쓴 말까지 — 다음 넘김은 그 뒤 말로만
      if (this.hook && r?.handoff?.id) hookRun(this.hook, 'handed', this, { text, said: oneLine(said.join(' / '), 500), refs: pre?.refs || [], handoff: r.handoff, ok: !!r?.ok });
      return [String(r?.text || (r?.ok ? '넣었어요' : '못 넣었어요')), !!r?.ok];
    }
    if (name === 'handoff_status') { await this.refresh(true); return [statusText(this.handoffs, oneLine(a.id, 30)), true]; }
    if (this.hook && this.extraTools.some(t => t.name === name)) {   // 고리가 더한 도구(주인 deck_item)
      const r = await hookRun(this.hook, 'tool', this, name, a);
      if (Array.isArray(r)) return [String(r[0] ?? ''), !!r[1]];
    }
    return [`모르는 도구 ${oneLine(name, 40)}`, false];
  }
  async refresh(force = false) {
    const open = this.handoffs.filter(h => ['in', 'sending', 'working', 'blocked'].includes(h.state));
    if (!open.length || (!force && Date.now() - this.refreshedAt < REFRESH_MS)) return;
    this.refreshedAt = Date.now();
    try {
      const r = await this.server('status', { handoffs: open.map(({ id, pane, at, state }) => ({ id, pane, at, state })) });
      for (const u of Array.isArray(r?.handoffs) ? r.handoffs : []) {
        const h = this.handoffs.find(x => x.id === u.id); if (!h) continue;
        const was = h.line || '';
        Object.assign(h, { state: u.state || h.state, kind: u.kind || '', line: u.line || '', recent: u.recent || '' });
        if (this.hook && h.line && h.line !== was) hookRun(this.hook, 'answered', this, h);   // 넘긴 일에 그 창이 답함 — 고리가 통화 중에 이어 말함(주인 handoff_refresh)
      }
    } catch {}
  }
  async start(offer) {
    await this.rpc('initialize', { clientInfo: { name: 'boarder_member_voice', version: '1' }, capabilities: { experimentalApi: true } });
    this.send({ method: 'initialized' });
    const r = await this.rpc('thread/start', { ...this.threadExtra, cwd: this.cwd, approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true, baseInstructions: this.instructions, dynamicTools: [...TOOLS, ...this.extraTools] });
    this.tid = r?.thread?.id;
    if (!this.tid) throw new Error('thread/start 답에 thread id 가 없어요');
    const got = new Promise(res => { this.sdpWait = res; });
    await this.rpc('thread/realtime/start', { ...this.realtimeExtra, threadId: this.tid, outputModality: 'audio', version: 'v3', includeStartupContext: false, prompt: this.instructions, transport: { type: 'webrtc', sdp: offer } });
    if (!this.sdp) await Promise.race([got, new Promise(res => setTimeout(res, 20_000))]);
    if (!this.sdp) throw new Error(this.reason || 'SDP 답이 안 옴');
    this.state = 'open';
    return this.sdp;
  }
  async say(text) { if (!this.tid || this.state !== 'open') return false; await this.rpc('thread/realtime/appendText', { threadId: this.tid, text: String(text).slice(0, 6000) }, 10_000); return true; }
  async greet() { if (this.greeted || !this.tid || this.state !== 'open') return false; this.greeted = true; return this.say(this.greetText || GREET); }
  async stop(why = '끊음') {
    try { if (this.tid && !this.exited) await this.rpc('thread/realtime/stop', { threadId: this.tid }, 5000); } catch {}
    this.closed(why);
    if (!this.exited) {
      try { this.p.kill('SIGTERM'); } catch {}
      await new Promise(res => { const t = setTimeout(() => { try { this.p.kill('SIGKILL'); } catch {} res(); }, 5000); this.p.once('exit', () => { clearTimeout(t); res(); }); if (this.exited) { clearTimeout(t); res(); } });
    }
  }
  /** 화면 poll: 상태 + 옮길 화면(한 번만 감) + 넘긴 일 */
  poll() {
    this.seen = Date.now();
    const screen = this.screenQ; this.screenQ = [];
    this.refresh().catch(() => {});   // 다음 poll 에 새 상태
    return { state: this.state, reason: this.reason, turns: this.turns.length, screen, handoffs: this.handoffs.map(({ id, name, state }) => ({ id, name, state })) };
  }
}

// ── 데몬이 부르는 동사(rtc_*) — 통화는 이 기기 안에만 있음
const calls = new Map();
const CID = /^[\w-]{8,64}$/;
const err = (code, msg) => Object.assign(new Error(msg), { code });
export const _calls = calls;   // 시험용

/** deps: { server(op, body) → json(기기 토큰 POST /api/device/voice), spawn?, env?, listWindows?() → [{id, spec:{cwd}, cwd}], home?, hook? }
 *  hook(기기 고리 — 없으면 회원 기기 그대로): start(a) → { instructions?, cwd?, tools?, thread?, realtime?, greet? } · started(call, a) · turn(call, t) · delegate(call, 글)
 *    · tool(call, 이름, 인자) → [글, 성공] · handoff(call, {text, said}) → { answer? | deck?, refs? } · handed(call, {text, said, refs, handoff, ok}) · answered(call, 넘김) · ended(call, 까닭) */
export async function handle(verb, a = {}, deps = {}) {
  const cid = String(a.cid || '');
  if (!CID.test(cid)) throw err(1, '통화 id 꼴이 틀려요');
  if (verb === 'rtc_start') {
    const sdp = String(a.sdp || '');
    if (!sdp.startsWith('v=0') || sdp.length > 20000) throw err(1, 'SDP 꼴이 틀려요');
    const ok = available(deps.env || process.env); if (!ok.ok) throw err(1, ok.why);
    if (calls.has(cid)) throw err(2, '같은 통화 id 가 이미 있어요');
    if (calls.size >= MAX_CALLS) throw err(2, `이 기기에선 통화를 동시에 ${MAX_CALLS}개까지 열어요`);
    let cwd = deps.home || path.join(os.homedir(), 'boarder');
    if (a.window && deps.listWindows) { try { const w = (await deps.listWindows()).find(x => x.id === a.window); const c = w?.spec?.cwd || w?.cwd; if (c) cwd = String(c).replace(/^~(?=$|\/)/, os.homedir()); } catch {} }
    const pane = String(a.pane || '');
    const server = (op, body) => deps.server(op, { cid, pane, ...body });
    calls.set(cid, null);   // 자리 잡기
    let c;
    try {
      const hook = deps.hook || null;
      const h = hook ? await Promise.race([hookRun(hook, 'start', a), new Promise(res => setTimeout(res, HOOK_START_MS).unref?.())]) : undefined;
      const hs = h && typeof h === 'object' ? h : {};
      if (typeof hs.cwd === 'string' && hs.cwd && existsSync(hs.cwd)) cwd = hs.cwd;
      const ins = typeof hs.instructions === 'string' && hs.instructions ? hs.instructions : String(a.instructions || '');
      c = new Call({ cid, pane, name: String(a.name || pane).slice(0, 80), cwd, instructions: [ins.slice(0, 20000), NO_SECRETS].filter(Boolean).join('\n\n'), bin: codexBin(deps.env || process.env), server, spawn: deps.spawn,
        hook, tools: hs.tools, thread: hs.thread, realtime: hs.realtime, greet: typeof hs.greet === 'string' ? hs.greet : '' });
      const answer = await c.start(sdp);
      c.seen = Date.now(); calls.set(cid, c);
      if (a.meet && !c.greetText) c.greeted = true;
      c.firstSaid = !!(a.meet && c.greetText);
      if (hook) hookRun(hook, 'started', c, a);
      return { cid, sdp: answer };
    } catch (e) {
      calls.delete(cid);
      if (c) await c.stop('시작 실패').catch(() => {});
      throw err(1, String(e.message || e).slice(0, 200));
    }
  }
  const c = calls.get(cid);
  if (verb === 'rtc_stop') { calls.delete(cid); if (c) { await c.stop('끊음'); if (c.hook) hookRun(c.hook, 'ended', c, ''); } return { ok: true, turns: c ? c.turns.length : 0 }; }
  if (!c) return verb === 'rtc_poll' ? { state: 'closed', reason: '통화가 없어요' } : { ok: false };
  if (verb === 'rtc_poll') return c.poll();
  if (verb === 'rtc_note') { c.seen = Date.now(); if (a.k === 'connected') c.greet().catch(() => {}); return { ok: true }; }
  if (verb === 'rtc_say') {
    c.seen = Date.now();
    let t = String(a.text || '');
    if (typeof a.first === 'string') {
      const first = !c.meetOn; c.meetOn = true;
      if (first) t = String((c.firstSaid && typeof a.firstSaid === 'string' && a.firstSaid) || a.first || t);
    }
    if (!t) return { ok: false };
    c.say(t).catch(() => {}); return { ok: true };
  }
  throw err(5, `unknown verb ${verb}`);
}
/** 15초마다: 화면이 끊겼거나(150초) 한 시간 넘은 통화 · 끝난 app-server 를 닫음 */
export function reap(now = Date.now()) {
  for (const [cid, c] of calls) if (c && (now - c.seen > IDLE_KILL_MS || now - c.at > MAX_CALL_MS || c.exited)) {
    const why = c.exited ? '엔진이 끝나 닫음' : now - c.at > MAX_CALL_MS ? '한 시간이 넘어 닫음' : '화면이 끊겨 닫음';   // 주인 voice_rtc reaper 와 같은 까닭
    calls.delete(cid); c.stop(why).then(() => { if (c.hook) hookRun(c.hook, 'ended', c, why); }).catch(() => {});
  }
}
export async function stopAll() { for (const [cid, c] of calls) { calls.delete(cid); if (c) await c.stop('엔진 끝').catch(() => {}); } }
