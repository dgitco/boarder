import type { Context, Hono } from "hono";

export type HostedCall = { method: string; path: string; headers: Record<string, string>; body?: Uint8Array };
export type HostedOut = { status: number; headers: Record<string, string>; body: Uint8Array };
type HEnv = { DB: D1Database };

export type Hosted = {
  /** Worker 라우트 붙이기 — index.ts 의 같은 자리(다리 WebSocket 앞)에서 한 번 */
  mount?(app: Hono<any>): void;
  /** 운영자 전용 라우트 붙이기 */
  admin?(app: Hono<any>, h: { admin(c: unknown): boolean; invite(env: any, owner: string, by: string): Promise<unknown> }): void;
  /** /api/health 에 더할 칸(이름 → 상태) */
  health?(env: HEnv): Promise<Record<string, unknown>>;
  /** 주인 요청 · 에이전트 도구를 다리 대신 보낼 통로 — on 이 거짓이면 다리 */
  exec?: {
    on(db: D1Database): Promise<boolean>;
    call(env: HEnv, ch: string, r: HostedCall): Promise<HostedOut>;
    tool(env: HEnv, ch: string, name: string, args: Record<string, unknown>, agent: string): Promise<unknown>;
  };
  /** 주인 /api/* 한 요청을 먼저 받기 — null 이면 코어 길 그대로 */
  route?(c: Context<any>, url: URL, ch: string, pass: { req: string[]; res: string[] }, seg: (name: string, ms: number) => void): Promise<Response | null>;
};

const mods = import.meta.glob<{ default: Hosted }>("./ee/index.ts", { eager: true });
export const hosted: Hosted = Object.values(mods)[0]?.default ?? {};
