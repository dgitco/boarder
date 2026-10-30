export const PRESETS: Record<string, string> = {
  airtable: "https://mcp.airtable.com/mcp",
  amplitude: "https://mcp.amplitude.com/mcp",
  apify: "https://mcp.apify.com",
  asana: "https://mcp.asana.com/v2/mcp",
  atlassian: "https://mcp.atlassian.com/v1/mcp",
  attio: "https://mcp.attio.com/mcp",
  "aws-knowledge": "https://knowledge-mcp.global.api.aws",
  axiom: "https://mcp.axiom.co/mcp",
  buildkite: "https://mcp.buildkite.com/mcp",
  canva: "https://mcp.canva.com/mcp",
  clickup: "https://mcp.clickup.com/mcp",
  close: "https://mcp.close.com/mcp",
  cloudflare: "https://mcp.cloudflare.com/mcp",
  "cloudflare-docs": "https://docs.mcp.cloudflare.com/mcp",
  cloudinary: "https://asset-management.mcp.cloudinary.com/mcp",
  context7: "https://mcp.context7.com/mcp",
  datadog: "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp",
  deepwiki: "https://mcp.deepwiki.com/mcp",
  dropbox: "https://mcp.dropbox.com/mcp",
  exa: "https://mcp.exa.ai/mcp",
  figma: "https://mcp.figma.com/mcp",
  fireflies: "https://api.fireflies.ai/mcp",
  gamma: "https://mcp.gamma.app/mcp",
  github: "https://api.githubcopilot.com/mcp/",
  gitlab: "https://gitlab.com/api/v4/mcp",
  grafana: "https://mcp.grafana.com/mcp",
  granola: "https://mcp.granola.ai/mcp",
  hex: "https://app.hex.tech/mcp",
  honeycomb: "https://mcp.honeycomb.io/mcp",
  hubspot: "https://mcp.hubspot.com",
  huggingface: "https://huggingface.co/mcp",
  intercom: "https://mcp.intercom.com/mcp",
  jam: "https://mcp.jam.dev/mcp",
  launchdarkly: "https://mcp.launchdarkly.com/mcp/fm",
  linear: "https://mcp.linear.app/mcp",
  mercury: "https://mcp.mercury.com/mcp",
  "microsoft-learn": "https://learn.microsoft.com/api/mcp",
  miro: "https://mcp.miro.com/",
  mixpanel: "https://mcp.mixpanel.com/mcp",
  monday: "https://mcp.monday.com/mcp",
  motherduck: "https://api.motherduck.com/mcp",
  neon: "https://mcp.neon.tech/mcp",
  netlify: "https://netlify-mcp.netlify.app/mcp",
  notion: "https://mcp.notion.com/mcp",
  "openai-docs": "https://developers.openai.com/mcp",
  pagerduty: "https://mcp.pagerduty.com/mcp",
  paypal: "https://mcp.paypal.com/mcp",
  planetscale: "https://mcp.pscale.dev/mcp/planetscale",
  posthog: "https://mcp.posthog.com/mcp",
  prisma: "https://mcp.prisma.io/mcp",
  railway: "https://mcp.railway.com/mcp",
  ramp: "https://mcp.ramp.com/mcp",
  render: "https://mcp.render.com/mcp",
  resend: "https://mcp.resend.com/mcp",
  sanity: "https://mcp.sanity.io",
  semgrep: "https://mcp.semgrep.ai/mcp",
  sentry: "https://mcp.sentry.dev/mcp",
  slack: "https://mcp.slack.com/mcp",
  socket: "https://mcp.socket.dev/",
  square: "https://mcp.squareup.com/mcp",
  stripe: "https://mcp.stripe.com",
  supabase: "https://mcp.supabase.com/mcp",
  todoist: "https://ai.todoist.net/mcp",
  vercel: "https://mcp.vercel.com",
  webflow: "https://mcp.webflow.com/mcp",
  wix: "https://mcp.wix.com/mcp",
  zapier: "https://mcp.zapier.com/api/mcp/mcp",
};

/** 동적 등록을 안 받는 곳 — 사용자가 만든 OAuth 앱(client_id · client_secret)을 연결 때 넣어야 함 */
export const PREREGISTERED = new Set(["asana", "github", "hubspot", "pagerduty", "render"]);

/** 화면에 보일 이름(없으면 service 그대로) */
export const TITLES: Record<string, string> = { github: "GitHub", gitlab: "GitLab", linear: "Linear", notion: "Notion", sentry: "Sentry", posthog: "PostHog", cloudflare: "Cloudflare", slack: "Slack", stripe: "Stripe", figma: "Figma", vercel: "Vercel", supabase: "Supabase", atlassian: "Atlassian", axiom: "Axiom", deepwiki: "DeepWiki", context7: "Context7" };

/** 서비스마다 요청할 권한(없으면 보호 자원이 말하는 전부) — GitHub 은 gist · 패키지 쓰기까지 내놓아 좁힘 */
export const SCOPES: Record<string, string> = { github: "repo read:org read:user user:email project notifications" };

export function hostedApp(env: Record<string, unknown>, service: string): { client_id: string; client_secret?: string } | null {
  const k = `APP_${service.toUpperCase().replace(/-/g, "_")}`, id = env[`${k}_CLIENT_ID`];
  return typeof id === "string" && id ? { client_id: id, client_secret: typeof env[`${k}_CLIENT_SECRET`] === "string" ? env[`${k}_CLIENT_SECRET`] as string : undefined } : null;
}
