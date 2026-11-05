import type { Context, Hono } from "hono";
import { readPrefs, savePrefs, repoOf, type NodePrefs } from "./node-prefs";
import { cleanPins, readPins, savePins, type Pin } from "./side-order";
import { foldRows, frontDoorOf, type FrontDoor } from "./front-door";
import { paneOfId } from "./member-board";
import { listDevices } from "./devices";
import { prefsPatch } from "./node-prefs";
import { cleanHide, readHide, saveHide } from "./side-order";
import { FEATS, isFeat, featsOf, setFeat } from "./status-pages/feature";

type Env = { DB: D1Database; PUBLIC_URL: string };
type C = Context<{ Bindings: Env }>;
export type Dev = { id: string; owner: string; name: string };
export type Hooks = {
  device: (c: C) => Promise<Dev | null>;
  ownWindow: (db: D1Database, me: string, target: string) => Promise<boolean>;
  regroup: (env: Env, me: string) => Promise<unknown>;
  card?: (env: Env, owner: string, card: { id: string; question: string }) => void;
  // 화면 길(index.ts)이 쓰는 같은 함수 · 표 — 설정 칸을 한 곳에서만 정의하려고 받음
  setUnit: (env: Env, me: string, unit: "goal" | "agent") => Promise<unknown>;
  uiPref: () => Record<string, (v: string) => boolean>;
  nodeValues: { read: (env: Env, me: string) => Promise<Record<string, number>>; save: (env: Env, me: string, raw: unknown) => Promise<Record<string, number>> };
  sessionSync: { get: (env: Env, me: string) => Promise<boolean>; set: (env: Env, me: string, on: boolean) => Promise<unknown> };
  flagsOff?: (env: Env) => string | undefined;
  avatar: { get: (env: Env, me: string) => Promise<{ seed: string; hue: number; photo?: string } | null>; set: (env: Env, me: string, face: { seed: string; hue: number; photo?: string }) => Promise<unknown>;
    clean: (v: unknown) => { seed: string; hue: number; photo?: string } | null; photoOk: (env: Env, photo: string) => Promise<boolean>; put: (env: Env, body: Uint8Array<ArrayBuffer>) => Promise<{ id: string } | { error: string; status: 400 | 413 }> };
  ownerNodeValues: { read: (env: Env) => Promise<Record<string, number> | null>; save: (env: Env, raw: unknown) => Promise<Record<string, number> | null> };
  isOwner: (env: Env, email: string) => boolean;
  mails: (env: Env, email: string) => string[];   // 이 사람의 기기 owner 메일들(주인은 넷)
  // 스위치 owner_unified_prep(주인 · 회원 한 길 ④ 준비): 켜지면 주인 기기도 회원 칸 전부 — 정본은 canon(첫 메일) 회원 줄. 끄면 예전(OWNER_KEYS 만 · 나머지 409)
  unified?: (env: Env) => Promise<boolean>;
  after?: (env: Env, me: string, key: Key) => Promise<unknown>;   // 바꾼 뒤(주인 이름 · 얼굴 거울 등). 실패해도 바꾸기는 그대로
};
export const OWNER_KEYS = ["pins", "side_hide", "ui", "features", "session_sync", "node_values"] as const;
// 주인 화면이 로그인한 메일 줄에서 읽는 칸 — 주인 메일 넷 모두에 같은 값(어느 메일로 들어와도 같게). 나머지 칸은 스위치가 켜지면 canon 줄 하나
export const MAIL_KEYS = ["pins", "side_hide", "ui", "features"] as const;
const OWNER_NO = "주인 보드의 이 칸은 서버 파일이 정본이라 아직 이 명령으로 못 바꿔요 — 보드 화면에서 해요";
export const TOUCHY_BUNDLES = ["phone-alert", "external-send", "account-autoswitch"] as const;
export const TOUCHY_RULES = ["outside", "ask"] as const;   // 바깥 발송 · 사람에게 묻기 규칙 — 끄면 에이전트가 승인 없이 움직이므로 같은 취급
// 사람 몸에 닿는 보드 설정 칸 — 에이전트끼리 접기(agents_fold)는 알림을 진행 묶음으로 바꾸고 읽지 않음 수에서 빼므로 폰 알림 묶음과 같은 취급.
//   승인 링크 동사가 아직 없어 보드 화면 설정(「에이전트끼리 접기」 스위치)에서 사람이 바꿈
export const TOUCHY_PREFS = ["agents_fold"] as const;

export const TTL = 10 * 60_000;
export const ALLOW = "허용", DENY = "거절";
const MAX_PENDING = 3;
export const MAX_DAY_CARDS = 5;   // 기기마다 하루 다섯(device-card.ts 와 같은 값)
export const LOCK_MS = 24 * 3600_000;   // 거절 뒤 그 기기의 카드를 안 세우는 시간
const DAY = 24 * 3600_000;
export const NOT_ALLOWED_HINT = "이 기기는 설정을 바꿀 허락이 없어요 — boarder settings allow 로 보드에 허락 카드를 세우고 사람이 「허용」을 눌러요";
export const KEYS = ["pins", "task_channels", "task_repo", "front_door", "primary_window", "bot_name", "node_values", "unit", "prefs", "side_hide", "ui", "features", "session_sync", "avatar"] as const;
export type Key = typeof KEYS[number];
export const LABEL: Record<Key, string> = { pins: "사이드바 고정 캔버스", task_channels: "채널 = 태스크", task_repo: "업무 저장소", front_door: "앞단 접기", primary_window: "기본 창", bot_name: "메인 봇 이름", node_values: "노드 수치(점검 주기 · 나누기 · 이동 · 이름 · 보관)", unit: "채널 묶는 단위", prefs: "노드 설정(주차 · 메인 봇 창 · 규칙 · 묶음 · 트리 정리)", side_hide: "사이드바 숨김 줄", ui: "모양 설정", features: "기능 켜기", session_sync: "세션 싱크", avatar: "내 아바타(모양 · 색 · 사진)" };
const NOSTORE = { "cache-control": "no-store" };
const ctl = (s: unknown, n: number) => String(s ?? "").replace(/[\x00-\x1f\x7f-\x9f]/g, "").trim().slice(0, n);
const cardId = (now: number) => `${Math.floor(now / 1000)}.${String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0")}`;
const grantKey = (dev: string) => `cli_settings:${dev}`;
const reqKey = (card: string) => `cli_settings_req:${card}`;
const askedKind = (dev: string) => `cli_settings_asked:${dev}`, lockedKind = (dev: string) => `cli_settings_locked:${dev}`;   // device_card_event.kind — 새 기기 카드의 'asked' · 'locked' 와 안 섞임

/** 이 기기가 설정 바꾸기를 허락받았는지 */
export async function allowed(db: D1Database, me: string, dev: string) {
  return !!(await db.prepare("SELECT 1 FROM user_pref WHERE owner = ? AND k = ?").bind(me, grantKey(dev)).first());
}
export const WIDE = "v2:";
export const OLD_KEYS = ["pins", "task_channels", "task_repo", "front_door", "primary_window", "bot_name"] as const;
export async function allowedWide(db: D1Database, me: string, dev: string) {
  const r = await db.prepare("SELECT v FROM user_pref WHERE owner = ? AND k = ?").bind(me, grantKey(dev)).first<{ v: string }>();
  return !!r && String(r.v).startsWith(WIDE);
}
/** 기다리는 허락 요청(10분 안)이 있는지 — 이 기기 것만 */
async function pendingOf(db: D1Database, me: string, dev: string, now = Date.now()) {
  return !!(await db.prepare("SELECT 1 FROM user_pref WHERE owner = ? AND k LIKE 'cli\\_settings\\_req:%' ESCAPE '\\' AND v = ? AND at > ?").bind(me, dev, now - TTL).first());
}
/** 만료: 10분 넘은 요청의 열린 카드를 닫고 요청 줄을 지움(그 회원 것만) */
async function sweep(db: D1Database, me: string, now = Date.now()) {
  if (!(await db.prepare("SELECT 1 FROM user_pref WHERE owner = ? AND k LIKE 'cli\\_settings\\_req:%' ESCAPE '\\' AND at <= ? LIMIT 1").bind(me, now - TTL).first())) return;   // CLI 가 3초마다 읽으므로 치울 게 있을 때만 씀
  await db.batch([
    db.prepare("UPDATE board_card SET state = 'closed', done = '만료' WHERE owner = ?1 AND state = 'open' AND id IN (SELECT substr(k, 18) FROM user_pref WHERE owner = ?1 AND k LIKE 'cli\\_settings\\_req:%' ESCAPE '\\' AND at <= ?2)").bind(me, now - TTL),
    db.prepare("DELETE FROM user_pref WHERE owner = ? AND k LIKE 'cli\\_settings\\_req:%' ESCAPE '\\' AND at <= ?").bind(me, now - TTL),
  ]);
}

/** 카드 답 고리(/api/me/cards/:id/answer 뒤) — 허용이고 10분 안이고 그 기기가 아직 살아 있으면 허락을 남김. 카드는 닫음 */
export async function onSettingsCardAnswered(env: { DB: D1Database }, me: string, id: string, now = Date.now()) {
  const r = await env.DB.prepare("SELECT q.v dev, q.at, c.answer FROM user_pref q JOIN board_card c ON c.id = ?2 AND c.owner = q.owner WHERE q.owner = ?1 AND q.k = ?3").bind(me, id, reqKey(id)).first<{ dev: string; at: number; answer: string | null }>();
  if (!r) return false;
  const won = await env.DB.prepare("DELETE FROM user_pref WHERE owner = ? AND k = ?").bind(me, reqKey(id)).run();   // 먼저 요청을 잡음(두 답이 겹쳐도 한 번만)
  if (!won.meta.changes) return true;
  const live = await env.DB.prepare("SELECT 1 FROM device WHERE id = ? AND owner = ? AND revoked_at IS NULL AND scope = 'full'").bind(r.dev, me).first();
  const ok = r.answer === ALLOW && now - r.at <= TTL && !!live;
  if (ok) await env.DB.prepare("INSERT INTO user_pref(owner, k, v, at) VALUES (?,?,?,?) ON CONFLICT(owner, k) DO UPDATE SET v = excluded.v, at = excluded.at").bind(me, grantKey(r.dev), WIDE + now, now).run();
  const done = ok ? "허용함 — 이 기기에서 boarder 설정 명령을 쓸 수 있어요" : r.answer === ALLOW ? (live ? "만료" : "그 기기가 끊겨 허용하지 않았어요") : "거절함";
  await env.DB.prepare("UPDATE board_card SET state = 'closed', done = ? WHERE id = ? AND owner = ? AND state = 'answered'").bind(done, id, me).run();
  if (r.answer !== ALLOW) await env.DB.prepare("INSERT INTO device_card_event(email, kind, at) VALUES (?, ?, ?)").bind(me, lockedKind(r.dev), now).run();
  return true;
}
/** 카드가 설정 허락 카드인지(답 길이 토큰 머리를 거절할 때) */
export const isSettingsCard = async (env: { DB: D1Database }, me: string, id: string) => !!(await env.DB.prepare("SELECT 1 FROM user_pref WHERE owner = ? AND k = ?").bind(me, reqKey(id)).first());

type Values = { pins: Pin[]; task_channels: boolean; task_repo: string; front_door: FrontDoor | null; primary_window: string | null; bot_name: string | null;
  node_values: Record<string, number>; unit: string | null; prefs: Record<string, unknown>; side_hide: string[]; ui: Record<string, string>; features: Record<string, boolean>; session_sync: boolean; avatar: { seed: string; hue: number; photo?: string } | null };
const valuesFor = async (env: Env, h: Hooks, me: string, owner: string, uni: boolean) => {
  const all = await readAll(env, h, me, uni);
  return h.isOwner(env, owner) && !uni ? Object.fromEntries(OWNER_KEYS.map(k => [k, all[k]])) : all;
};
async function readAll(env: Env, h: Hooks, me: string, uni = false): Promise<Values> {
  const db = env.DB;
  const [p, pins, pw, bot, nv, unit, hide, ui, feats, sync, avatar] = await Promise.all([
    readPrefs(db, me), readPins(db, me),
    db.prepare("SELECT v FROM user_pref WHERE owner = ? AND k = 'primary_win'").bind(me).first<{ v: string }>(),
    db.prepare("SELECT name FROM member_bot WHERE owner = ?").bind(me).first<{ name: string }>(),
    h.isOwner(env, me) && !uni ? h.ownerNodeValues.read(env).then(v => v ?? h.nodeValues.read(env, me)) : h.nodeValues.read(env, me),
    db.prepare("SELECT json_extract(data, '$.unit') u FROM node_setting WHERE owner = ? AND json_valid(data)").bind(me).first<{ u: string | null }>().catch(() => null),
    readHide(db, me),
    db.prepare("SELECT k, v FROM user_pref WHERE owner = ? AND k LIKE 'ui:%'").bind(me).all<{ k: string; v: string }>(),
    featsOf(db, me, h.flagsOff?.(env)),
    h.sessionSync.get(env, me),
    h.avatar.get(env, me),
  ]);
  const uiv: Record<string, string> = {};
  for (const r of ui.results || []) { const k = r.k.slice(3); if (Object.hasOwn(h.uiPref(), k) && h.uiPref()[k](r.v)) uiv[k] = r.v; }
  const { task_channels, task_repo, front_door, ...prefs } = p;   // 이 셋은 위에 따로 있음
  return { pins, task_channels, task_repo, front_door, primary_window: pw?.v || null, bot_name: bot?.name ?? null,
    node_values: nv, unit: unit?.u === "goal" || unit?.u === "agent" ? unit.u : null, prefs, side_hide: hide, ui: uiv, features: feats, session_sync: sync, avatar };
}
const canvasId = (s: string) => { const t = s.trim(), m = /\/(?:art|canvas)\/([A-Za-z0-9_-]{4,64})\/?(?:[?#].*)?$/.exec(t); return m ? m[1] : t; };
/** 보드 기록에 남길 짧은 값 */
export const show = (k: Key, v: unknown) => v === null || v === "" ? "없음" : k === "pins" ? (v as Pin[]).map(p => p.id).join(", ") || "없음" : k === "front_door" ? `${(v as FrontDoor).name}(${(v as FrontDoor).pairs.map(p => p.name).join(" · ")})` : typeof v === "boolean" ? (v ? "켬" : "끔") : typeof v === "object" ? JSON.stringify(v).slice(0, 300) : String(v);

/** 그 회원 보드 기록에 「기기 ○○ 이 CLI 로 △△ 을 바꿨어요 — 전 → 후」 한 줄(실패해도 바꾸기는 그대로).
 *  화면 덧씌우기 알림과 같은 시스템 줄(engine.ts sysLine 꼴: kind sys · thread primary) — 그냥 progress 줄이면 묶기가 「보더」라는 노드 칸을 새로 만듦 */
export const logChange = (db: D1Database, me: string, device: string, label: string, before: string, after: string) =>
  db.prepare("INSERT INTO board_log(owner, win, kind, text, thread, at) VALUES (?,?,?,?,?,?)").bind(me, "보더", "sys", ctl(`기기 「${ctl(device, 60)}」 이 CLI 로 ${label} 을 바꿨어요 — 전: ${before} → 후: ${after}`, 600), "primary", Date.now()).run().catch(() => {});

type Out = { after: unknown } | { error: string; status: 400 | 403 | 404 | 409; extra?: Record<string, unknown> };
async function apply(env: Env, h: Hooks, me: string, key: Key, value: unknown, cur: Values, uni = false): Promise<Out> {
  const DB = env.DB;
  if (key === "pins") {
    if (!Array.isArray(value)) return { error: "pins: 캔버스 id(또는 주소) 목록", status: 400 };
    const titles = new Map(cur.pins.map(p => [p.id, p.title]));
    // 글이면 주소 → id, 객체면 { id, title }(되돌리기가 제목까지 보냄 — CLI `<id>=<제목>`). 제목이 없으면 지금 목록의 제목을 이어 씀
    const pins = cleanPins(value.map(x => { const o = (typeof x === "string" ? { id: x } : Object(x)) as { id?: unknown; title?: unknown }, id = canvasId(String(o.id ?? "")); return { id, title: (typeof o.title === "string" && o.title) || titles.get(id) || "" }; }));
    if (!pins) return { error: "캔버스 주소가 틀렸거나 12개를 넘었어요", status: 400 };
    await savePins(DB, me, pins);
    return { after: pins };
  }
  if (key === "task_channels") {
    if (typeof value !== "boolean") return { error: "task_channels: true | false", status: 400 };
    await savePrefs(DB, me, { task_channels: value }); await h.regroup(env, me);   // 화면 길(/api/me/nodeset)과 같이 바로 다시 묶음
    return { after: value };
  }
  if (key === "task_repo") {
    const r = value === null ? "" : repoOf(value);
    if (r === null) return { error: "task_repo: \"owner/repo\" (빈 값 = 지움)", status: 400 };
    await savePrefs(DB, me, { task_repo: r }); await h.regroup(env, me);
    return { after: r };
  }
  if (key === "front_door") {
    if (value === null) { await savePrefs(DB, me, { front_door: null } as Partial<NodePrefs>); return { after: null }; }
    const o = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
    let fd: FrontDoor | null = null;
    if (Array.isArray(o.fold)) {   // 이름으로 접기: 역할 자리표(/api/device/roles 의 fold)와 같은 찾기 — 이름이 정확히 같은 내 노드(업무 · Slack 노드 제외)
      const names = [...new Set(o.fold.map(x => ctl(x, 80)).filter(Boolean))].slice(0, 8);
      if (!names.length) return { error: "front_door.fold: 접을 노드 이름 목록", status: 400 };
      const rows = await foldRows(DB, me, names);
      const missing = names.filter(n => !rows.some(r => r.nm === n));
      if (missing.length) return { error: "그 이름의 내 노드가 없어요 — 아무것도 안 바꿨어요", status: 404, extra: { missing } };
      fd = frontDoorOf({ name: o.name, pairs: rows.map(r => ({ pane: paneOfId(r.id), name: r.nm })), aliases: Array.isArray(o.aliases) ? o.aliases : names });
    } else fd = frontDoorOf(o);
    if (!fd) return { error: "front_door: { name, fold: [노드 이름…] } 또는 null(끄기)", status: 400 };
    await savePrefs(DB, me, { front_door: fd });
    return { after: fd };
  }
  if (key === "primary_window") {
    const t = value === null ? "" : typeof value === "string" ? value.trim().slice(0, 300) : null;
    if (t === null) return { error: "primary_window: \"window:…\" | \"ew_…\" | null(메인 봇으로)", status: 400 };
    if (!t) { await DB.prepare("DELETE FROM user_pref WHERE owner = ? AND k = 'primary_win'").bind(me).run(); return { after: null }; }
    if (!(await h.ownWindow(DB, me, t))) return { error: "내 살아 있는 창이 아니에요", status: 404 };
    await DB.prepare("INSERT INTO user_pref(owner, k, v, at) VALUES (?,?,?,?) ON CONFLICT(owner, k) DO UPDATE SET v = excluded.v, at = excluded.at").bind(me, "primary_win", t, Date.now()).run();
    return { after: t };
  }
  if (key === "node_values") {
    const o = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
    if (!o || !Object.values(o).length || !Object.values(o).every(v => typeof v === "number" && Number.isFinite(v))) return { error: "node_values: { check_min | split_at | move_h | rename_h | archive_h: 숫자 } (보낸 칸만 바뀜)", status: 400 };
    const bad = Object.keys(o).filter(k => !Object.hasOwn(cur.node_values, k));
    if (bad.length) return { error: `모르는 칸: ${bad.join(", ")}`, status: 400 };
    if (h.isOwner(env, me) && !uni) {   // 주인: 정본 owner_state(화면 길과 같은 OS.nodeSet). 스위치가 꺼졌거나 seed 전이면 서버 파일이 정본이라 거절
      const v = await h.ownerNodeValues.save(env, o);
      return v ? { after: v } : { error: "주인 노드 수치의 정본(owner_state)이 아직 준비 전이에요(seed 전)", status: 409 };
    }
    return { after: await h.nodeValues.save(env, me, o) };
  }
  if (key === "unit") {
    if (value !== "goal" && value !== "agent") return { error: "unit: \"goal\" | \"agent\"", status: 400 };
    await h.setUnit(env, me, value); await h.regroup(env, me);
    return { after: value };
  }
  if (key === "prefs") {
    const patch = prefsPatch(value);
    if (!patch) return { error: "prefs: { park_on, park_h, task_dots, tree_tidy, primary_item, rules: {…}, bundles: {…} } 중 바꿀 칸 (틀린 칸은 무시되고 하나도 없으면 거절)", status: 400 };
    const touchy = TOUCHY_BUNDLES.filter(k => patch.bundles && k in patch.bundles && patch.bundles[k] !== (cur.prefs.bundles as Record<string, boolean> | undefined)?.[k]);
    const rulesNow = cur.prefs.rules as Record<string, boolean> | undefined;
    for (const k of TOUCHY_RULES) if (patch.rules && k in patch.rules && patch.rules[k as never] !== rulesNow?.[k]) touchy.push(`rules.${k}` as never);
    for (const k of TOUCHY_PREFS) if (k in patch && patch[k] !== undefined && patch[k] !== !!cur.prefs[k]) touchy.push(`prefs.${k}` as never);
    if (touchy.length) return { error: `approval_required: ${touchy.join(", ")} 는 사람 몸에 닿아 기기 허락만으로는 못 바꿔요 — 사람이 링크로 승인해요: ${touchy.map(t => t.startsWith("rules.") ? `boarder approve rule.set name=${t.slice(6)} on=…` : t.startsWith("prefs.") ? `보드 화면 설정에서 사람이 「${t.slice(6)}」 스위치를 바꿔요` : `boarder approve bundle.set name=${t} on=…`).join(" · ")}`, status: 403 };
    await savePrefs(DB, me, patch);
    if (patch.primary_item !== undefined || patch.park_on !== undefined || patch.park_h !== undefined || patch.tree_tidy !== undefined) await h.regroup(env, me);
    const after = { ...(await readPrefs(DB, me)) } as Record<string, unknown>; delete after.task_channels; delete after.task_repo; delete after.front_door;
    return { after };
  }
  if (key === "side_hide") {
    const hide = cleanHide(value);
    if (!hide) return { error: "side_hide: [\"node\" | \"canvas\" | \"feed\"…] (빈 목록 = 다 보임)", status: 400 };
    await saveHide(DB, me, hide);
    return { after: hide };
  }
  if (key === "ui") {
    const o = value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value as Record<string, unknown>) : [];
    if (!o.length || o.length > 12 || o.some(([k, v]) => !Object.hasOwn(h.uiPref(), k) || typeof v !== "string" || !h.uiPref()[k](v))) return { error: `ui: { ${Object.keys(h.uiPref()).join(" | ")}: 값 } (화면과 같은 값 범위)`, status: 400 };
    const now = Date.now();
    await DB.batch(o.map(([k, v]) => DB.prepare("INSERT INTO user_pref(owner, k, v, at) VALUES (?,?,?,?) ON CONFLICT(owner, k) DO UPDATE SET v = excluded.v, at = excluded.at").bind(me, "ui:" + k, v as string, now)));
    return { after: Object.fromEntries(o) };
  }
  if (key === "features") {
    const o = value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value as Record<string, unknown>) : [];
    if (!o.length || o.some(([k, v]) => !isFeat(k) || typeof v !== "boolean")) return { error: `features: { ${FEATS.join(" | ")}: true | false }`, status: 400 };
    const off = String(h.flagsOff?.(env) || "").split(",").map(x => x.trim());
    if (o.some(([k, v]) => v && off.includes(k))) return { error: "이 서버에서 꺼 둔 기능이에요", status: 409 };
    for (const [k, v] of o) await setFeat(DB, me, k as never, v as boolean);
    return { after: await featsOf(DB, me, h.flagsOff?.(env)) };
  }
  if (key === "session_sync") {
    if (typeof value !== "boolean") return { error: "session_sync: true | false", status: 400 };
    if (value && !cur.session_sync) return { error: "approval_required: 세션 싱크를 켜면 대화가 서버에 저장되기 시작해요 — 사람이 링크로 승인해요: boarder approve session-sync.on (끄기는 이 명령으로 돼요)", status: 403 };
    await h.sessionSync.set(env, me, value);
    return { after: value };
  }
  if (key === "avatar") {   // 모양(seed) · 색(hue) · 사진(photo = 먼저 boarder avatar 가 올린 사진 id). 화면 길(/api/me/avatar)과 같은 검사
    const o = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
    const f = h.avatar.clean(o ? { ...(cur.avatar || {}), ...o } : null);   // 보낸 칸만 바뀌고 나머지는 지금 값
    if (!f) return { error: "avatar: { seed: 글(영문·숫자·공백 40자까지), hue: 0–359, photo?: 사진 id } (보낸 칸만 바뀜)", status: 400 };
    if (!(await h.avatar.photoOk(env, f.photo || ""))) return { error: "그 사진 id 가 없어요 — boarder avatar set --photo <파일> 로 먼저 올려요", status: 400 };
    await h.avatar.set(env, me, f);
    return { after: f };
  }
  // bot_name: 이름만(모양 · 색 · 그림은 화면에서 만든 그대로). 아직 메인 봇을 안 만든 회원은 화면에서 먼저(그림이 있어야 하는 줄)
  if (typeof value !== "string" || value.length > 200) return { error: "이름은 1–20자 글이에요", status: 400 };
  const name = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
  if (!name || [...name].length > 20) return { error: "이름은 1–20자예요", status: 400 };
  const u = await DB.prepare("UPDATE member_bot SET name = ?, updated_at = ? WHERE owner = ?").bind(name, Date.now(), me).run();
  if (!u.meta.changes) return { error: "메인 봇이 아직 없어요 — 보드 화면에서 먼저 만들어요", status: 409 };
  return { after: name };
}

export function mountDeviceSettings(host: Hono<any>, h: Hooks) {
  const app = host as unknown as Hono<{ Bindings: Env }>;
  app.get("/api/device/settings", async c => {
    const d = await h.device(c); if (!d) return c.json({ error: "기기 토큰" }, 401);
    const me = d.owner.toLowerCase(), owner = h.isOwner(c.env, d.owner), uni = owner && !!(await h.unified?.(c.env));
    await sweep(c.env.DB, me);
    return c.json({ allowed: await allowed(c.env.DB, me, d.id), allowed_wide: await allowedWide(c.env.DB, me, d.id), pending: await pendingOf(c.env.DB, me, d.id), ...(owner ? { owner: true } : {}), ...(uni ? { unified: true } : {}), values: await valuesFor(c.env, h, owner ? h.mails(c.env, d.owner)[0].toLowerCase() : me, d.owner, uni) }, 200, NOSTORE);
  });
  app.post("/api/device/settings", async c => {
    const d = await h.device(c); if (!d) return c.json({ error: "기기 토큰" }, 401);
    const me = d.owner.toLowerCase();
    if (!(await allowed(c.env.DB, me, d.id))) return c.json({ error: "not_allowed", hint: NOT_ALLOWED_HINT }, 403, NOSTORE);
    const b = Object(await c.req.json().catch(() => ({}))) as { key?: unknown; value?: unknown };
    const key = String(b.key ?? "") as Key;
    if (!KEYS.includes(key)) return c.json({ error: `key: ${KEYS.join(" | ")}` }, 400, NOSTORE);
    const owner = h.isOwner(c.env, d.owner), uni = owner && !!(await h.unified?.(c.env));
    if (owner && !uni && !(OWNER_KEYS as readonly string[]).includes(key)) return c.json({ error: OWNER_NO }, 409, NOSTORE);
    if (!(OLD_KEYS as readonly string[]).includes(key) && !(await allowedWide(c.env.DB, me, d.id))) return c.json({ error: "not_allowed", hint: "이 기기의 옛 허락은 새 설정 칸을 포함하지 않아요 — boarder settings allow 로 허락을 다시 받아요" }, 403, NOSTORE);
    if (!("value" in b)) return c.json({ error: "value 가 없어요" }, 400, NOSTORE);
    const all = owner ? [...new Set(h.mails(c.env, d.owner).map(x => x.toLowerCase()))] : [me];
    const targets = uni && !(MAIL_KEYS as readonly string[]).includes(key) ? all.slice(0, 1) : all, main = targets[0];
    const cur = await readAll(c.env, h, main, uni), before = cur[key];
    let r = await apply(c.env, h, main, key, b.value, cur, uni);
    for (const m of targets.slice(1)) { if ("error" in r) break; const x = await apply(c.env, h, m, key, b.value, await readAll(c.env, h, m, uni), uni); if ("error" in x) r = x; }
    if ("error" in r) return c.json({ error: r.error, ...(r.extra || {}) }, r.status, NOSTORE);
    await h.after?.(c.env, main, key).catch(() => null);
    await logChange(c.env.DB, me, d.name, LABEL[key], show(key, before), show(key, r.after));
    return c.json({ ok: true, key, before, after: r.after }, 200, NOSTORE);
  });
  // 내 기기 목록(읽기만, 허락 불필요) — 이름 · 도구 · 범위 · 마지막 연결. 지표 · 이력은 뺌(무거움). 폐기는 일부러 CLI 에 없음(되돌릴 수 없음 · 보안): 보드 화면에서
  app.get("/api/device/devices", async c => {
    const d = await h.device(c); if (!d) return c.json({ error: "기기 토큰" }, 401, NOSTORE);
    const list = await listDevices(c.env.DB, h.mails(c.env, d.owner));
    return c.json({ this: d.id, devices: (list as unknown as Record<string, unknown>[]).map(x => ({ id: x.id, name: x.name, tools: x.tools, scope: x.scope, created_at: x.created_at, last_at: x.last_at, engine_at: x.engine_at ?? null })) }, 200, NOSTORE);
  });
  // 아바타 사진 올리기(PNG · JPEG · WebP 1.5MB 이하) → 사진 id. 설정을 바꿔도 되는 기기만(저장소를 아무나 채우지 못하게) · 주인은 아직 화면에서만
  app.post("/api/device/avatar-image", async c => {
    const d = await h.device(c); if (!d) return c.json({ error: "기기 토큰" }, 401, NOSTORE);
    if (h.isOwner(c.env, d.owner) && !(await h.unified?.(c.env))) return c.json({ error: OWNER_NO }, 409, NOSTORE);   // 스위치가 켜지면 주인도(사진 id 는 내용 해시라 열쇠와 무관)
    const me = d.owner.toLowerCase();
    if (!(await allowedWide(c.env.DB, me, d.id))) return c.json({ error: "not_allowed", hint: NOT_ALLOWED_HINT }, 403, NOSTORE);
    if (+(c.req.header("content-length") || 0) > 1_500_000) return c.json({ error: "사진이 너무 커요" }, 413, NOSTORE);
    // content-length 가 없거나 거짓인 큰 본문도 1.5MB 를 넘기는 순간 끊음(다 읽은 뒤 413 이 아니라)
    const chunks: Uint8Array[] = []; let n = 0; const rd = c.req.raw.body?.getReader();
    while (rd) { const x = await rd.read(); if (x.done) break; n += x.value.byteLength; if (n > 1_500_000) { await rd.cancel().catch(() => {}); return c.json({ error: "사진이 너무 커요" }, 413, NOSTORE); } chunks.push(x.value); }
    const all = new Uint8Array(n); let o = 0; for (const ch of chunks) { all.set(ch, o); o += ch.byteLength; }
    const r = await h.avatar.put(c.env, all);
    return "error" in r ? c.json({ error: r.error }, r.status, NOSTORE) : c.json({ ok: true, id: r.id }, 200, NOSTORE);
  });
  app.get("/api/device/settings/allow", async c => {
    const d = await h.device(c); if (!d) return c.json({ error: "기기 토큰" }, 401);
    const me = d.owner.toLowerCase();
    await sweep(c.env.DB, me);
    return c.json({ allowed: await allowedWide(c.env.DB, me, d.id), pending: await pendingOf(c.env.DB, me, d.id) }, 200, NOSTORE);
  });
  app.post("/api/device/settings/allow", async c => {
    const d = await h.device(c); if (!d) return c.json({ error: "기기 토큰" }, 401);
    if (h.isOwner(c.env, d.owner)) return c.json({ error: "주인 서버 기기는 카드 대신 사람이 승인 링크로 권한을 줘요 — boarder approve ownercli.enable" }, 409, NOSTORE);
    const me = d.owner.toLowerCase(), now = Date.now();
    if (await allowedWide(c.env.DB, me, d.id)) return c.json({ allowed: true, pending: false }, 200, NOSTORE);   // 옛 허락(범위 좁음)이면 새 카드를 세워 다시 허락받음
    await sweep(c.env.DB, me, now);
    const open = await c.env.DB.prepare("SELECT substr(k, 18) card FROM user_pref WHERE owner = ? AND k LIKE 'cli\\_settings\\_req:%' ESCAPE '\\' AND v = ? LIMIT 1").bind(me, d.id).first<{ card: string }>();
    if (open) return c.json({ allowed: false, pending: true, card_id: open.card }, 200, NOSTORE);
    const ev = await c.env.DB.prepare("SELECT sum(kind = ? AND at > ?) AS asked, sum(kind = ? AND at > ?) AS locked FROM device_card_event WHERE email = ?").bind(askedKind(d.id), now - DAY, lockedKind(d.id), now - LOCK_MS, me).first<{ asked: number | null; locked: number | null }>();
    if ((ev?.locked ?? 0) > 0) return c.json({ error: "보드에서 이 기기의 허락 요청을 거절한 지 24시간이 안 됐어요 — 그 뒤에 다시 요청해요" }, 429, NOSTORE);
    if ((ev?.asked ?? 0) >= MAX_DAY_CARDS) return c.json({ error: "이 기기는 오늘 허락 요청을 다섯 번 했어요 — 내일 다시 요청해요" }, 429, NOSTORE);
    const n = await c.env.DB.prepare("SELECT count(*) n FROM user_pref WHERE owner = ? AND k LIKE 'cli\\_settings\\_req:%' ESCAPE '\\'").bind(me).first<{ n: number }>();
    if ((n?.n ?? 0) >= MAX_PENDING) return c.json({ error: "기다리는 허락 요청이 너무 많아요 — 보드의 카드부터 답해요" }, 429, NOSTORE);
    const id = cardId(now), name = ctl(d.name, 60) || "이름 없는 기기";
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM device_card_event WHERE at < ?").bind(now - 2 * DAY),
      c.env.DB.prepare("INSERT INTO device_card_event(email, kind, at) VALUES (?, ?, ?)").bind(me, askedKind(d.id), now),
      c.env.DB.prepare("INSERT INTO board_card(id, owner, win, question, choices, recommend, body, at) VALUES (?,?,?,?,?,?,?,?)")
        .bind(id, me, "보더", `기기 「${name}」 이 CLI 로 내 보드 설정을 바꾸려 해요 — 허용할까요?`, JSON.stringify([ALLOW, DENY]), null,
          `허용하면 이 기기(그 기기의 에이전트 포함)가 boarder 명령으로 ${KEYS.map(k => LABEL[k]).join(" · ")} 과 역할 자리표를 바꾸고, 내 로그인 화면에서 도는 스크립트(화면 덧씌우기 js)도 올릴 수 있어요 — 스크립트는 내 화면에서 나처럼 움직이니 내 기기만 허용하세요. 바꿀 때마다 전 값이 이 보드 기록에 남아요. 기기를 끊으면 허락도 같이 끝나요. 내가 시킨 일이 아니면 「${DENY}」(하루 동안 이 기기의 요청이 다시 오지 않아요). 10분 안에 답하지 않으면 만료돼요.`, now),
      c.env.DB.prepare("INSERT INTO user_pref(owner, k, v, at) VALUES (?,?,?,?)").bind(me, reqKey(id), d.id, now),
    ]);
    h.card?.(c.env, me, { id, question: `기기 「${name}」 설정 바꾸기 허용?` });
    return c.json({ allowed: false, pending: true, card_id: id }, 200, NOSTORE);
  });
  app.delete("/api/device/settings/allow", async c => {
    const d = await h.device(c); if (!d) return c.json({ error: "기기 토큰" }, 401);
    const u = await c.env.DB.prepare("DELETE FROM user_pref WHERE owner = ? AND k = ?").bind(d.owner.toLowerCase(), grantKey(d.id)).run();
    return c.json({ ok: true, was: !!u.meta.changes }, 200, NOSTORE);
  });
}
