// node --test --no-warnings --experimental-transform-types apps/web/worker/importer/revoked.test.ts — 끊은 기기 rv: 옛 줄마다 하위 질의와 같은 값인지(메모리 SQLite, migrations 전부)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { REVOKED_SQL, withRv } from "./revoked.ts";

const MIG = new URL("../../migrations/", import.meta.url);
const OLD = "SELECT key, device_id, (SELECT d.revoked_at IS NOT NULL FROM device d WHERE d.id = imp_item.device_id) rv FROM imp_item WHERE owner = ? ORDER BY key";

test("끊긴 기기 창만 rv 1 — 옛 하위 질의와 같은 값, 남의 끊긴 기기는 안 섞임", () => {
  const db = new DatabaseSync(":memory:");
  for (const f of readdirSync(MIG).filter(f => f.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(f, MIG), "utf8"));
  const dev = db.prepare("INSERT INTO device (id, owner, token_hash, created_at, revoked_at) VALUES (?, ?, ?, 1, ?)");
  dev.run("d_live", "me", "h1", null); dev.run("d_off", "me", "h2", 5); dev.run("d_other", "you", "h3", 7);
  const it = db.prepare("INSERT INTO imp_item (owner, key, kind, seen_at, device_id) VALUES (?, ?, 'window', 1, ?)");
  it.run("me", "window:a", "d_live"); it.run("me", "window:b", "d_off"); it.run("me", "window:c", "d_off"); it.run("you", "window:z", "d_other");
  const old = db.prepare(OLD).all("me").map(r => ({ ...(r as object) })) as { key: string; device_id: string; rv: number }[];
  const off = db.prepare(REVOKED_SQL).all("me").map(r => ({ ...(r as object) })) as { id: string }[];
  const rows = withRv(db.prepare("SELECT key, device_id FROM imp_item WHERE owner = ? ORDER BY key").all("me").map(r => ({ ...(r as object) })) as { key: string; device_id: string }[], off);
  assert.deepEqual(rows.map(r => [r.key, r.rv]), old.map(r => [r.key, r.rv]));
  assert.deepEqual(rows.map(r => r.rv), [0, 1, 1]);
});
