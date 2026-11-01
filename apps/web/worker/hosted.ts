import type { Context, Hono } from "hono";
import type { ZodType } from "zod";
import type { D1ScopeSpec } from "./vault/migrate";

export type HostedCall = { method: string; path: string; headers: Record<string, string>; body?: Uint8Array };
export type HostedOut = { status: number; headers: Record<string, string>; body: Uint8Array };
type HEnv = { DB: D1Database };
/** 코어 길이 확장 라우트에 빌려주는 것 — 로그인 메일(주인 · 회원 공통, 없으면 null) · 같은 사이트 쓰기 확인 */
export type MountHelp = { me(c: Context<any>): Promise<string | null>; sameSite(c: Context<any>): boolean };
/** 에이전트 도구를 부른 신원 — 전부 토큰에서(머리 값 아님). owner '' = 주인 토큰 */
export type ToolWho = { env: any; owner: string; win: string; agent: string; test?: boolean };
export type HostedToolDef = { name: string; title: string; description: string; inputSchema: Record<string, unknown>; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } };

export type Hosted = {
  /** Worker 라우트 붙이기 — index.ts 의 같은 자리(다리 WebSocket 앞)에서 한 번 */
  mount?(app: Hono<any>, h: MountHelp): void;
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
  /** 에이전트 도구 더하기(MCP · /api/agent) — 코어 도구처럼 꺼진 채 등록, run 안에서 스위치 검사 */
  tools?: { defs: HostedToolDef[]; schemas: Record<string, ZodType>; reads: string[]; run(who: ToolWho, name: string, args: Record<string, any>): Promise<unknown> };
  /** 쓰기 rid 한 번만(queue.ts idem)을 탈 길 — QPATHS 밖의 확장 길 */
  qpath?(path: string): boolean;
  /** 폴링 표(GET /api/live)에 더할 칸 */
  liveTags?(env: any, email: string): Promise<Record<string, string>>;
  tick?(env: any, wait: (p: Promise<unknown>) => void): void;
  route?(c: Context<any>, url: URL, ch: string, pass: { req: string[]; res: string[] }, seg: (name: string, ms: number) => void): Promise<Response | null>;
  /** 봉투 옮기기(vault/migrate.ts)에 더할 호스팅 전용 D1 표(이름 → 칸 · 줄 키 · DEK 주인) — 없으면 그 scope 가 없음 */
  vaultScopes?: Record<string, D1ScopeSpec>;
};

const mods = import.meta.glob<{ default: Hosted }>("./ee/index.ts", { eager: true });
export const hosted: Hosted = Object.values(mods)[0]?.default ?? {};
