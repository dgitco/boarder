
const MAX = 120;

const clean = (s: unknown): string | null => {
  if (typeof s !== "string") return null;
  const one = s.replace(/\s+/g, " ").trim();
  return one ? one.slice(0, MAX) : null;
};

/** The email (or name) an OpenID id_token is for. Unverified: it is only shown, never trusted. */
export function accountOfIdToken(jwt: string): string | null {
  try {
    const part = jwt.split(".")[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "="));
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(json, (c) => c.charCodeAt(0)))) as Record<string, unknown>;
    return clean(claims.email) ?? clean(claims.preferred_username) ?? clean(claims.name);
  } catch {
    return null;
  }
}

/**
 * "Who am I" tools, called once with these arguments after a connection is ready when its sign-in
 * didn't say who it is. Only tools that read; `hosts` limits a tool name others may use differently.
 */
export const WHOAMI: { tool: string; args: Record<string, unknown>; hosts?: RegExp }[] = [
  { tool: "get_user", args: { query: "me" }, hosts: /(^|\.)linear\.app$/ },
  { tool: "slack_read_user_profile", args: { response_format: "concise" }, hosts: /(^|\.)slack\.com$/ },
  { tool: "notion-get-self", args: {}, hosts: /(^|\.)notion\.com$/ },
  // Any server's own, by the usual names, when it takes no arguments.
  { tool: "whoami", args: {} },
  { tool: "get_me", args: {} },
  { tool: "get_current_user", args: {} },
];

/** The probe for this server among its tools, if any. */
export function whoamiFor(url: string, tools: { name: string; inputSchema?: unknown }[]): { tool: string; args: Record<string, unknown> } | null {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {}
  for (const w of WHOAMI) {
    if (w.hosts && !w.hosts.test(host)) continue;
    const t = tools.find((x) => x.name === w.tool);
    if (!t) continue;
    const required = (t.inputSchema as { required?: unknown } | undefined)?.required;
    if (!w.hosts && Array.isArray(required) && required.length) continue;
    return { tool: w.tool, args: w.args };
  }
  return null;
}

/** Keys that name the account, best first: a workspace or team, then the person. */
const KEYS = ["workspace_name", "workspaceName", "team_name", "teamName", "organization_name", "email", "name", "login", "username"];

/** The account in a who-am-I tool's answer: JSON (searched a few levels deep, then its strings) or text with an email in it. */
export function accountFromText(text: string): string | null {
  try {
    const v: unknown = JSON.parse(text);
    const found = pick(v, 0) ?? emailIn(strings(v, 0).join("\n"));
    if (found) return found;
  } catch {}
  return emailIn(text);
}

/**
 * The first email in text. An escape written out (a JSON string's `\n` as two characters, as
 * Slack's profile answer has it) separates words: `Bob\nbob@example.com` is bob@example.com, not nbob@example.com.
 */
function emailIn(text: string): string | null {
  const plain = text.replace(/\\+(?:u[0-9a-fA-F]{4}|[nrtbf"/])|\\{2,}/g, " ");
  return clean(/(?<![\w.+-])[\w.+-]+@[\w-]+(\.[\w-]+)+/.exec(plain)?.[0]);
}

function strings(v: unknown, depth: number): string[] {
  if (typeof v === "string") return [v];
  if (!v || typeof v !== "object" || depth > 3) return [];
  return Object.values(v as Record<string, unknown>).flatMap((x) => strings(x, depth + 1));
}

/** Bumped when reading accounts changes, so a connection's stored one is read again once (hub.ts probeAccount). */
export const ACCOUNT_READ = 2;

/**
 * Whether an account read again replaces the stored one: only when the stored one is the new email
 * with what's left of an escape stuck in front (`nbob@example.com` from `\nbob@example.com`, before
 * ACCOUNT_READ 2). An account that really starts with n reads the same again, so it stays; a
 * workspace name or another address from sign-in isn't touched.
 */
export const fixesAccount = (stored: string, found: string): boolean =>
  found.includes("@") && stored.length > found.length && stored.endsWith(found) && /^(?:[nrtbf]|u[0-9a-fA-F]{4})$/.test(stored.slice(0, -found.length));

function pick(v: unknown, depth: number): string | null {
  if (!v || typeof v !== "object" || depth > 3) return null;
  const o = v as Record<string, unknown>;
  for (const k of KEYS) if (typeof o[k] === "string" && clean(o[k])) return clean(o[k]);
  for (const x of Array.isArray(v) ? v : Object.values(o)) {
    const r = pick(x, depth + 1);
    if (r) return r;
  }
  return null;
}
