import { build } from "vite";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
const ver = JSON.parse(readFileSync(new URL("../node_modules/@tanstack/query-core/package.json", import.meta.url), "utf8")).version;
const dir = mkdtempSync(join(tmpdir(), "tq-")), entry = join(dir, "entry.js");
const mod = createRequire(import.meta.url).resolve("@tanstack/query-core");   // 임시 폴더의 입구에서도 찾게 절대 경로
writeFileSync(entry, `export { QueryClient, QueryObserver, InfiniteQueryObserver, focusManager, onlineManager, hashKey } from ${JSON.stringify(mod)};\n`);
await build({ configFile: false, logLevel: "warn", root: new URL("..", import.meta.url).pathname, define: { "process.env.NODE_ENV": JSON.stringify("production") },   // 브라우저엔 process 가 없음
  build: { lib: { entry, formats: ["iife"], name: "TQ", fileName: () => "tq.js" }, outDir: dir, emptyOutDir: false, minify: true, sourcemap: false } });
const out = readFileSync(join(dir, "tq.js"), "utf8");
writeFileSync(new URL("../worker/legacy/tq.js", import.meta.url), `/*! @tanstack/query-core ${ver} — MIT License, Copyright (c) 2021-present Tanner Linsley. 묶음: apps/web/scripts/vendor-tq.mjs */\n` + out);
rmSync(dir, { recursive: true, force: true });
console.log("legacy/tq.js", ver, out.length, "bytes");
