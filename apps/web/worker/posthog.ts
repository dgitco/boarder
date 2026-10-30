export type PH = { POSTHOG_KEY?: string; POSTHOG_HOST?: string };

export const snippet = (env: PH, email?: string) => !env.POSTHOG_KEY ? "" :
  `<script>!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once unregister identify alias reset captureException set_config".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
posthog.init(${JSON.stringify(env.POSTHOG_KEY)},{api_host:location.origin+"/ph",ui_host:"https://us.posthog.com",person_profiles:"identified_only",capture_exceptions:true,capture_performance:{web_vitals:true},disable_session_recording:true,capture_pageleave:true});
posthog.register({app:"boarder-web"});${email ? `posthog.identify(${JSON.stringify(email)},{email:${JSON.stringify(email)}});` : ""}</script>`;

// Worker 쪽 이벤트(배치 없이 한 통, 실패해도 요청엔 영향 없음 — 응답 뒤 waitUntil)
export function capture(env: PH, ctx: { waitUntil(p: Promise<unknown>): void } | undefined, event: string, distinctId: string, properties: Record<string, unknown>) {
  if (!env.POSTHOG_KEY || !ctx) return;
  ctx.waitUntil(fetch(`${env.POSTHOG_HOST || "https://us.i.posthog.com"}/i/v0/e/`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: env.POSTHOG_KEY, event, distinct_id: distinctId, properties: { app: "boarder-worker", ...properties } }),
    signal: AbortSignal.timeout(5000),
  }).catch(() => {}));
}
