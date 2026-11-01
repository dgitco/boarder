/**
 * R2 몸통 봉하기 — 64 KiB 조각마다 AES-GCM(사람 DEK). 꼴:
 *   머리 16바이트 = 표지 8("\0bv2\0\0\0\1") + DEK 판(u32 BE) + 조각 크기(u32 BE), 그 뒤 조각마다 iv 12 + 암호문(조각 + 꼬리표 16).
 *   조각 AAD = key|ver|i|last — 다른 key 로 옮기기 · 조각 바꿔 끼우기 · 뒤를 잘라내기가 다 안 열림(빈 몸통도 빈 마지막 조각 하나).
 * 조각이 고정 크기라 평문 Range(a..b) → 암호문 조각 범위가 셈으로 나옴(blobInfo · openBlobRange — files.ts 동영상 Range 가 씀).
 * 머리 표지가 없으면 그대로 돌려줌(늦은 옮기기 — 옛 평문 몸통).
 */
import { type Bytes, _gcm as gcm, _ungcm as ungcm, envelopeOn, getDek, VaultError, type VaultEnv } from "./index";

export const BLOB_CHUNK = 64 * 1024;
const MAGIC = [0x00, 0x62, 0x76, 0x32, 0x00, 0x00, 0x00, 0x01], HEAD = 16, OVER = 12 + 16;
const bytes = (d: ArrayBuffer | ArrayBufferView | string): Bytes => typeof d === "string" ? new TextEncoder().encode(d) : d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d.buffer as ArrayBuffer, d.byteOffset, d.byteLength);   // R2 · fetch 몸통은 SharedArrayBuffer 가 아님
const isSealedBlob = (b: Uint8Array) => b.length >= HEAD && MAGIC.every((x, i) => b[i] === x);
const caad = (key: string, ver: number, i: number, last: boolean) => `${key}|${ver}|${i}|${last ? 1 : 0}`;

/** 봉한 크기(R2 put 의 길이 · customMetadata 에 평문 크기를 따로 둘 때) */
export const sealedSize = (n: number, chunk = BLOB_CHUNK) => HEAD + Math.max(1, Math.ceil(n / chunk)) * OVER + n;

/** 스위치가 꺼져 있으면 받은 것을 그대로 */
export async function sealBlob<D extends ArrayBuffer | ArrayBufferView | string>(env: VaultEnv, owner: string, key: string, data: D, chunk = BLOB_CHUNK): Promise<D | Uint8Array> {
  if (!(await envelopeOn(env, owner))) return data;
  const { ver, key: k } = await getDek(env, owner, { create: true });
  const pt = bytes(data), n = Math.max(1, Math.ceil(pt.length / chunk));
  const parts = await Promise.all(Array.from({ length: n }, (_, i) => gcm(k, pt.subarray(i * chunk, (i + 1) * chunk), caad(key, ver, i, i === n - 1))));
  const out = new Uint8Array(sealedSize(pt.length, chunk));
  out.set(MAGIC);
  const dv = new DataView(out.buffer); dv.setUint32(8, ver); dv.setUint32(12, chunk);
  let o = HEAD;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export async function openBlob(env: VaultEnv, owner: string, key: string, data: ArrayBuffer | ArrayBufferView): Promise<Bytes> {
  const b = bytes(data);
  if (!isSealedBlob(b)) return b;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), ver = dv.getUint32(8), chunk = dv.getUint32(12);
  if (!chunk || chunk > 16 << 20) throw new VaultError("몸통 머리 깨짐");
  const body = b.length - HEAD, n = Math.ceil(body / (chunk + OVER));
  if (n < 1) throw new VaultError("몸통 잘림");
  const { key: k } = await getDek(env, owner, { ver });
  const parts = await Promise.all(Array.from({ length: n }, (_, i) => {
    const s = HEAD + i * (chunk + OVER);
    return ungcm(k, b.subarray(s, Math.min(s + chunk + OVER, b.length)), caad(key, ver, i, i === n - 1));
  }));
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export type BlobInfo = { ver: number; chunk: number; n: number; plain: number; size: number };
type Read = (offset: number, length: number) => Promise<Bytes>;
/** 봉한 몸통의 머리(없으면 null — 봉하지 않은 몸통) */
export async function blobInfo(read: Read, size: number): Promise<BlobInfo | null> {
  if (size < HEAD + OVER) return null;
  const h = await read(0, HEAD);
  if (!isSealedBlob(h)) return null;
  const dv = new DataView(h.buffer, h.byteOffset, h.byteLength), ver = dv.getUint32(8), chunk = dv.getUint32(12);
  if (!chunk || chunk > 16 << 20) throw new VaultError("몸통 머리 깨짐");
  const n = Math.ceil((size - HEAD) / (chunk + OVER));
  return { ver, chunk, n, plain: size - HEAD - n * OVER, size };
}
/** 평문 바이트 a..z(둘 다 포함)만. 조각 i 의 암호문 자리 = HEAD + i·(chunk+28) — 셈으로 바로 */
export async function openBlobRange(env: VaultEnv, owner: string, key: string, read: Read, info: BlobInfo, a: number, z: number): Promise<Bytes> {
  if (a < 0 || z < a || z >= info.plain) throw new VaultError("범위 밖");
  const C = info.chunk, i0 = Math.floor(a / C), i1 = Math.floor(z / C), step = C + OVER;
  const off = HEAD + i0 * step, end = Math.min(HEAD + (i1 + 1) * step, info.size);
  const raw = await read(off, end - off);
  if (raw.length !== end - off) throw new VaultError("몸통 잘림");
  const { key: k } = await getDek(env, owner, { ver: info.ver });
  const parts = await Promise.all(Array.from({ length: i1 - i0 + 1 }, (_, j) => {
    const i = i0 + j, s = j * step;
    return ungcm(k, raw.subarray(s, Math.min(s + step, raw.length)), caad(key, info.ver, i, i === info.n - 1));
  }));
  const all = new Uint8Array(parts.reduce((x, p) => x + p.length, 0));
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  return all.slice(a - i0 * C, z - i0 * C + 1);
}
