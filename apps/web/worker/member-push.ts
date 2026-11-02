// 회원 웹 푸시 더하기: 어느 카드에 알림을 보내나 · 한 브라우저 구독 주소는 한 회원 것만.
// 구독 자체(열쇠 · 보내기 · 몰림 묶기)는 push-do.ts 회원 칸 그대로

export const pushKind = (kind: unknown) => kind !== "todo";

/** 이 구독 주소를 me 것으로 적고, 다른 회원 것으로 적혀 있었으면 그 회원 칸 구독을 지움(unsub). 지운 옛 회원 메일, 없으면 null */
export async function claimEndpoint(db: D1Database, me: string, endpoint: string, unsub: (owner: string) => Promise<unknown>) {
  if (!endpoint) return null;
  const prev = (await db.prepare("SELECT owner FROM member_push_ep WHERE endpoint = ?").bind(endpoint).first<{ owner: string }>())?.owner || null;
  if (prev && prev !== me) await unsub(prev);
  await db.prepare("INSERT INTO member_push_ep(endpoint, owner, at) VALUES (?,?,?) ON CONFLICT(endpoint) DO UPDATE SET owner = excluded.owner, at = excluded.at").bind(endpoint, me, Date.now()).run();
  return prev && prev !== me ? prev : null;
}
/** 구독을 끔 — 내 것으로 적힌 줄만 지움 */
export async function releaseEndpoint(db: D1Database, me: string, endpoint: string) {
  if (endpoint) await db.prepare("DELETE FROM member_push_ep WHERE endpoint = ? AND owner = ?").bind(endpoint, me).run();
}
