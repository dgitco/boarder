import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { register } from "node:module";
register("./test-hooks.mjs", import.meta.url);
const { get } = await import("./member-board.ts");
const { inbox } = await import("./member-inbox.ts");
const { prefsPatch, savePrefs } = await import("./node-prefs.ts");
const OWNER = "seat@example.test", T = Date.now() - 60_000;
function mkDb() {
  const db = new DatabaseSync(":memory:"), mig = new URL("../migrations/", import.meta.url);
  for (const f of readdirSync(mig).filter(x => x.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, mig), "utf8"));
  let batches = 0;
  const stmt = (sql: string, args: unknown[] = []): any => ({ bind: (...a: unknown[]) => stmt(sql, a), all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }), first: async () => db.prepare(sql).get(...(args as never[])) ?? null, run: async () => { const r = db.prepare(sql).run(...(args as never[])); return { success: true, meta: { changes: Number(r.changes) } }; } });
  return { db, D1: { prepare: (sql: string) => stmt(sql), batch: async (ss: any[]) => { batches++; return Promise.all(ss.map(s => s.all())); } } as any, nb: () => batches };
}
for (const fold of [false, true]) test("seat tk_tech task_channels fold=" + fold, async () => {
  const { db, D1, nb } = mkDb(), TK = "tk_tech";
  const log0 = (win: string, kind: string, text: string, dt: number) => db.prepare("INSERT INTO board_log(owner,win,kind,text,thread,at) VALUES(?,?,?,?,?,?)").run(OWNER, win, kind, text, null, T + dt);
  db.prepare("INSERT INTO mnode(owner,id,name,area,state,why,counts,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(OWNER, TK, "기술 부서장", "", "working", "", JSON.stringify({ main: "window:lead:1" }), T, T);
  db.prepare("INSERT INTO imp_item(owner,key,device_id,kind,engine,title,state,win,session,seen_at,handle) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(OWNER, "window:lead:1", "demo", "window", "herdr-own", "기술장", "working", "lead:1", "sess-tk", T, "{}");
  db.prepare("INSERT INTO mnode_item(owner,item,node,how) VALUES(?,?,?,'pin')").run(OWNER, "window:lead:1", TK);
  db.prepare("INSERT INTO imp_item(owner,key,device_id,kind,engine,title,state,win,session,seen_at,handle) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(OWNER, "window:wk:2", "demo", "window", "herdr-own", "작업자", "working", "wk:2", "sess-wk", T, "{}"); db.prepare("INSERT INTO mnode_item(owner,item,node,how) VALUES(?,?,?,'pin')").run(OWNER, "window:wk:2", TK); log0("wk:2", "progress", "작업자 진행", 0.5);
  db.prepare("INSERT INTO node_setting(owner,data,updated_at) VALUES(?,?,?)").run(OWNER, JSON.stringify({ roles: [{ name: "기술 부서장", win: "demo:lead:1", node: TK }] }), T);
  const log = (win: string, kind: string, text: string, dt: number) => db.prepare("INSERT INTO board_log(owner,win,kind,text,thread,at) VALUES(?,?,?,?,?,?)").run(OWNER, win, kind, text, null, T + dt);
  log("lead:1", "reply", "작업자 결과", 1); log("other:9", "reply", "다른 창 글", 1.5); log("lead:1", "status", "상태 줄", 2); log("기술 부서장", "me", "물음", 3); log("lead:1", "reply", "답", 4);
  await savePrefs(D1, OWNER, prefsPatch({ task_channels: true, ...(fold ? { agents_fold: true } : {}) })!);
  const b0 = nb();
  const r = await get(D1, OWNER, { name: "봇" }, new URL("/api/nodechat?w=" + encodeURIComponent("기술 부서장"), "https://x.test"), async () => null);
  const j = await r!.json() as any;
  if (fold) assert.ok(j.messages[0]?.fold?.agents, "켠 사람: 맨 위에 에이전트끼리 접은 글");
  else assert.ok(j.layers && j.layers.agents >= 1, "끈 사람: 태스크 두 겹 그대로 " + JSON.stringify(j.layers ?? null));
  void nb; void inbox;
});
