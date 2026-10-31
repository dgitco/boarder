type Env = { DB: D1Database; RESULTS: R2Bucket };
export type Row = { name: string; key: string; mime: string; by_email: string; at: number };

export const NAME = /^[a-z0-9가-힣_-]{2,40}$/;
// 기본 세트(블롭 얼굴) 이름 = <봇>-<표정> — 보드 board.html BLOB_BOTS · BLOB_EXPR 와 같은 표
export const BOTS = ["primary", "dgit", "company", "shop", "personal"];
export const EXPR = ["happy", "love", "thinking", "surprised", "sad", "sleepy"];
const BLOB_NAME = new RegExp(`^(${BOTS.join("|")})-(${EXPR.join("|")})$`);
const MIME: Record<string, string> = { "image/png": "png", "image/gif": "gif", "image/jpeg": "jpg", "image/webp": "webp" };
export const MAX = 512 * 1024;   // 화면이 128×128 로 줄여 보냄 — GIF 는 움직임 그대로라 조금 넉넉히

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const url = (r: Row) => "emoji/i/" + r.key.slice("emoji/".length);

export async function list(env: Env, me: string | null, admin: boolean) {
  const [rs, off] = await env.DB.batch([
    env.DB.prepare("SELECT name, key, mime, by_email, at FROM emoji ORDER BY at DESC"),
    env.DB.prepare("SELECT bot FROM emoji_bot"),
  ]);
  return {
    org: (rs.results as Row[]).map(r => ({ name: r.name, url: url(r), by: r.by_email.split("@")[0], at: r.at, mine: !!me && (admin || r.by_email === me) })),
    off: (off.results as { bot: string }[]).map(x => x.bot),
    admin,
  };
}

// std = 표준 이모지 이름(emoji.json) — 같은 이름은 표준이 이김이라 막음
export async function add(env: Env, me: string, rawName: string, mime: string, body: ArrayBuffer, std: Set<string>): Promise<[number, object]> {
  const name = rawName.trim().toLowerCase().replace(/^:|:$/g, "");
  if (!NAME.test(name)) return [400, { ok: false, error: "이름은 한글 · 영문 소문자 · 숫자 · - _ 로 2–40자예요" }];
  if (!std.size) return [503, { ok: false, error: "일시적인 오류가 발생했어요" }];
  if (std.has(name) || BLOB_NAME.test(name)) return [409, { ok: false, error: "같은 이름이 있어요" }];
  const ext = MIME[mime]; if (!ext) return [400, { ok: false, error: "PNG · GIF · JPG · WEBP 그림만 돼요" }];
  if (!body.byteLength || body.byteLength > MAX) return [400, { ok: false, error: "그림이 너무 커요" }];
  if (await env.DB.prepare("SELECT 1 FROM emoji WHERE name = ?").bind(name).first()) return [409, { ok: false, error: "같은 이름이 있어요" }];
  const nh = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(name))).slice(0, 16);
  const key = `emoji/${hex(await crypto.subtle.digest("SHA-256", body))}-${nh}.${ext}`;
  await env.RESULTS.put(key, body, { httpMetadata: { contentType: mime } });
  // 동시에 같은 이름 둘 — 기본 키 충돌이면 나중 것이 「같은 이름」(그림은 내용 해시라 남아도 무해)
  const r = await env.DB.prepare("INSERT INTO emoji(name, key, mime, by_email, at) VALUES (?,?,?,?,?) ON CONFLICT(name) DO NOTHING").bind(name, key, mime, me, Date.now()).run();
  if (!r.meta.changes) return [409, { ok: false, error: "같은 이름이 있어요" }];
  return [200, { ok: true, name, url: url({ name, key, mime, by_email: me, at: 0 }) }];
}

export async function remove(env: Env, me: string, admin: boolean, rawName: string): Promise<[number, object]> {
  const name = String(rawName || "").trim().toLowerCase().replace(/^:|:$/g, "");
  const r = await env.DB.prepare("SELECT by_email, key FROM emoji WHERE name = ?").bind(name).first<{ by_email: string; key: string }>();
  if (!r) return [404, { ok: false, error: "없는 이모지예요" }];
  if (!admin && r.by_email !== me) return [403, { ok: false, error: "올린 사람 · 관리자만 지울 수 있어요" }];
  await env.DB.prepare("DELETE FROM emoji WHERE name = ?").bind(name).run();
  // 그림 키는 이름마다 따로(add) — 같은 이름을 바로 다시 올린 줄이 이 키를 쓰면 그림은 둠
  if (!(await env.DB.prepare("SELECT 1 FROM emoji WHERE key = ?").bind(r.key).first())) await env.RESULTS.delete(r.key).catch(() => {});
  return [200, { ok: true }];
}

export async function bot(env: Env, me: string, b: string, on: boolean): Promise<[number, object]> {
  if (!BOTS.includes(b)) return [400, { ok: false, error: "없는 봇이에요" }];
  await (on ? env.DB.prepare("DELETE FROM emoji_bot WHERE bot = ?").bind(b)
    : env.DB.prepare("INSERT INTO emoji_bot(bot, by_email, at) VALUES (?,?,?) ON CONFLICT(bot) DO NOTHING").bind(b, me, Date.now())).run();
  return [200, { ok: true }];
}

export async function image(env: Env, file: string) {
  if (!/^[0-9a-f]{64}-[0-9a-f]{16}\.(png|gif|jpg|webp)$/.test(file)) return null;
  const o = await env.RESULTS.get("emoji/" + file); if (!o) return null;
  // 키 = 내용 · 이름 해시라 영영 같음
  return new Response(o.body, { headers: { "content-type": o.httpMetadata?.contentType || "application/octet-stream", "cache-control": "private, max-age=31536000, immutable", "x-content-type-options": "nosniff" } });
}
