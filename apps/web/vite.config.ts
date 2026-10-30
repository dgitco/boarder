import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// 웹(React SPA)과 API(Worker, Hono)를 한 번에 빌드 — 배포는 Worker 하나 + 정적 자산
export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  resolve: { alias: { "@": "/src" } },
});
