/**
 * 커넥터 비밀(connection.auth · connection_pending.auth · hook.secret) 봉하기 — seal.ts(CONNECTOR_KEY 하나)를 사람별 DEK 로 갈음하는 고리.
 * 스위치 envelope 꺼짐: seal.ts 의 seal · open 을 그대로 부름(바이트까지 지금과 같음). 켜짐: sealField(JSON 글월), AAD = 표|줄 id|칸|판.
 * 읽기는 스위치와 무관: "v2." 꼴이면 vault 로, 아니면 seal.ts open(옛 "v1." · 빈 값) — 켰다 꺼도 이미 봉한 줄은 열림.
 */
import { open as v1open, seal as v1seal } from "../connectors/seal";
import { envelopeOn, openField, sealField, type VaultEnv } from "./index";

type Env = { DB: D1Database; CONNECTOR_KEY?: string };
export type SecretRef = { tbl: "connection" | "connection_pending" | "hook"; pk: string; col: "auth" | "secret" };
const ve = (env: Env) => env as unknown as VaultEnv;

export async function sealSecret(env: Env, owner: string, ref: SecretRef, v: unknown): Promise<string> {
  if (!(await envelopeOn(ve(env), owner))) return v1seal(env.CONNECTOR_KEY, v);
  return (await sealField(ve(env), owner, ref, JSON.stringify(v))) as string;
}

export async function openSecret<T = Record<string, unknown>>(env: Env, owner: string, ref: SecretRef, s: string): Promise<T> {
  if (s && s.startsWith("v2.")) return JSON.parse((await openField(ve(env), owner, ref, s)) as string) as T;
  return v1open<T>(env.CONNECTOR_KEY, s);
}
