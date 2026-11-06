// 기준선 비교만 prepare 호출을 끔. 나머지 앱·DO·SQL은 같은 코드.
export { resolve } from "./test-hooks.mjs";
import { load as baseLoad } from "./test-hooks.mjs";
export async function load(u, c, n) {
  const r = await baseLoad(u, c, n);
  if (process.env.CLAIM_BASELINE && u.endsWith("/worker/queue.ts")) return { ...r, source: String(r.source).replace("prepare?.(body);", "/* 기준선: 순차 읽기 */") };
  return r;
}
