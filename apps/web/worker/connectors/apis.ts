import { GMAIL, GMAIL_SCOPE, GMAIL_READ_TOOLS } from "./gmail";
import { IMAP_TOOLS, imapLogin, openImap, type OpenImap } from "./imap";
export type ApiAuth =
  | { type: "bearer" }
  | { type: "header"; name: string }
  | { type: "query"; name: string }
  | { type: "basic" }
  /** 키 여럿, 머리마다 하나(채널톡: x-access-key + x-access-secret). 한 값에 줄마다 키 하나 */
  | { type: "headers"; names: string[] }
  /** app: "gmail" 이면 Gmail 테스트 앱(GMAIL_CLIENT_ID), 없으면 DGit 구글 앱(GOOGLE_CLIENT_ID) */
  | { type: "oauth"; provider: "google" | "slack" | "github"; scope: string; app?: "gmail" }
  /** 메일함(imap.ts) — HTTP 가 아님: 키 = 서버 · 주소 · 앱 비밀번호, 줄마다 하나 */
  | { type: "imap" };
export interface ApiSpec { preset?: string; baseUrl: string; auth: ApiAuth; headers?: Record<string, string> }
export interface CallResult { content: { type: "text"; text: string }[]; isError?: boolean }
export type ApiFetch = (path: string, init?: { method?: string; query?: Record<string, unknown>; body?: unknown; headers?: Record<string, string> }) => Promise<Response>;
export interface ApiTool {
  name: string; title?: string; description: string; inputSchema: Record<string, unknown>; annotations?: Record<string, unknown>;
  /** extra.imap: 로그인한 IMAP 세션을 여는 함수(메일(IMAP) 커넥터 도구만) */
  run(call: ApiFetch, args: Record<string, unknown>, extra?: { imap?: OpenImap }): Promise<CallResult>;
}

const MAX_TEXT = 100_000;
export const text = (s: string, isError = false): CallResult => ({ content: [{ type: "text", text: s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}\n…(cut at ${MAX_TEXT} characters)` : s }], isError });

/** A response as a tool result: JSON pretty-printed, errors marked, long bodies cut. */
export async function asResult(res: Response, pick?: (json: any) => unknown): Promise<CallResult> {
  const body = await res.text();
  let out = body;
  try {
    const json = JSON.parse(body);
    out = JSON.stringify(res.ok && pick ? pick(json) : json, null, 1);
  } catch {}
  return res.ok ? text(out || `${res.status} ${res.statusText}`) : text(`${res.status} ${res.statusText}\n${out}`, true);
}

// ── Any API: one request tool within the base URL ─────────
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];

const READ_METHODS = ["GET", "HEAD"];

/**
 * A custom API's tools: `get` for reads and `request` for everything that changes data, so clients
 * can run reads freely and ask before each write. Both name the API by its base URL.
 */
function requestTools(baseUrl: string): ApiTool[] {
  const tool = (write: boolean): ApiTool => ({
    name: write ? "request" : "get",
    title: write ? `Change data at ${baseUrl}` : `Read from ${baseUrl}`,
    description: write
      ? `Send a request that changes data (POST, PUT, PATCH, DELETE) to the API at ${baseUrl}; your credentials are added for you. Pass the path under the base URL, e.g. "/v1/items". Returns the status and body. Reads go through get.`
      : `Read from the API at ${baseUrl} (GET); your credentials are added for you. Pass the path under the base URL, e.g. "/v1/items". Returns the status and body.`,
    inputSchema: {
      type: "object",
      properties: {
        ...(write ? { method: { type: "string", enum: METHODS.filter((m) => !READ_METHODS.includes(m)), description: "The HTTP method" } } : {}),
        path: { type: "string", description: "Path under the base URL, with or without a leading slash" },
        query: { type: "object", description: "Query parameters", additionalProperties: true },
        ...(write ? { body: { description: "JSON body (objects are sent as JSON), or a string sent as is" } } : {}),
        headers: { type: "object", description: "Extra headers (auth headers are set for you and can't be overridden)", additionalProperties: { type: "string" } },
      },
      required: write ? ["method", "path"] : ["path"],
    },
    annotations: write ? { readOnlyHint: false, destructiveHint: true, openWorldHint: false } : { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async run(call, a) {
      const method = write ? String(a.method ?? "").toUpperCase() : "GET";
      if (write && (!METHODS.includes(method) || READ_METHODS.includes(method))) return text(`method is one of ${METHODS.filter((m) => !READ_METHODS.includes(m)).join(", ")}; reads go through get`, true);
      const res = await call(String(a.path ?? ""), { method, query: a.query as Record<string, unknown>, body: write ? a.body : undefined, headers: a.headers as Record<string, string> });
      const r = await asResult(res);
      return { ...r, content: [{ type: "text", text: `${res.status} ${res.statusText}\n${r.content[0]!.text}` }] };
    },
  });
  return [tool(false), tool(true)];
}

/** Resolve `path` under `base`, refusing anything that would leave it (another host, `..` above the base path). */
export function under(base: string, path: string): URL {
  const b = new URL(base.endsWith("/") ? base : `${base}/`);
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//")) throw new Error("pass a path under the base URL, not a full URL");
  const u = new URL(path.replace(/^\/+/, ""), b);
  if (u.origin !== b.origin || !u.pathname.startsWith(b.pathname)) throw new Error(`${path} is outside ${base}`);
  return u;
}


const CAL = "https://www.googleapis.com/calendar/v3";
const cal = (id: unknown) => encodeURIComponent(String(id || "primary"));
const calendarId = { type: "string", description: 'Calendar id; "primary" (default) is the user\'s own. See list_calendars.' };

const when = (v: unknown, tz?: unknown) => {
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? { date: s } : { dateTime: s, ...(tz ? { timeZone: String(tz) } : {}) };
};

/** The fields agents need from an event, not Google's whole record. */
const slimEvent = (e: any) => ({
  id: e.id,
  summary: e.summary,
  start: e.start?.dateTime ?? e.start?.date,
  end: e.end?.dateTime ?? e.end?.date,
  ...(e.location ? { location: e.location } : {}),
  ...(e.description ? { description: String(e.description).slice(0, 2000) } : {}),
  ...(e.attendees?.length ? { attendees: e.attendees.map((a: any) => `${a.email}${a.responseStatus ? ` (${a.responseStatus})` : ""}`) } : {}),
  ...(e.hangoutLink ? { meet: e.hangoutLink } : {}),
  ...(e.recurringEventId ? { recurringEventId: e.recurringEventId } : {}),
  status: e.status,
  htmlLink: e.htmlLink,
});

const eventFields = {
  summary: { type: "string", description: "Title" },
  start: { type: "string", description: 'Start: "2026-10-01T15:00:00+09:00", "2026-10-01T15:00:00" with timeZone, or "2026-10-01" for all day' },
  end: { type: "string", description: "End, same form as start (for all day, the day after the last day)" },
  timeZone: { type: "string", description: 'IANA time zone for start/end without an offset, e.g. "Asia/Seoul"' },
  description: { type: "string" },
  location: { type: "string" },
  attendees: { type: "array", items: { type: "string" }, description: "Emails to invite" },
  sendUpdates: { type: "string", enum: ["all", "externalOnly", "none"], description: "Email the attendees (default none)" },
};

function eventBody(a: Record<string, unknown>) {
  return {
    ...(a.summary !== undefined ? { summary: a.summary } : {}),
    ...(a.description !== undefined ? { description: a.description } : {}),
    ...(a.location !== undefined ? { location: a.location } : {}),
    ...(a.start !== undefined ? { start: when(a.start, a.timeZone) } : {}),
    ...(a.end !== undefined ? { end: when(a.end, a.timeZone) } : {}),
    ...(Array.isArray(a.attendees) ? { attendees: a.attendees.map((email) => ({ email: String(email) })) } : {}),
  };
}

const GOOGLE_CALENDAR_TOOLS: ApiTool[] = [
  {
    name: "list_calendars",
    description: "The user's calendars (their own and ones shared with them), with ids to use in the other tools.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    run: async (call) =>
      asResult(await call("/users/me/calendarList", { query: { maxResults: 250 } }), (j) =>
        (j.items ?? []).map((c: any) => ({ id: c.id, summary: c.summaryOverride ?? c.summary, primary: c.primary ?? false, accessRole: c.accessRole, timeZone: c.timeZone })),
      ),
  },
  {
    name: "create_calendar",
    description: "Make a new calendar (a secondary calendar in the user's account). Events can then be added to it by its id.",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Its name" },
        description: { type: "string" },
        timeZone: { type: "string", description: 'IANA time zone, e.g. "Asia/Seoul" (default: the account\'s)' },
      },
      required: ["summary"],
    },
    async run(call, a) {
      // Google makes a new calendar UTC unless told otherwise; the account's zone is its primary calendar's.
      let timeZone = a.timeZone;
      if (!timeZone) {
        const res = await call("/users/me/calendarList/primary");
        if (res.ok) timeZone = ((await res.json()) as { timeZone?: string }).timeZone;
      }
      return asResult(await call("/calendars", { method: "POST", body: { summary: a.summary, ...(a.description ? { description: a.description } : {}), ...(timeZone ? { timeZone } : {}) } }), (c) => ({
        id: c.id,
        summary: c.summary,
        timeZone: c.timeZone,
      }));
    },
  },
  {
    name: "delete_calendar",
    description: "Delete a calendar made with create_calendar, with all its events. Only those: other calendars can't be deleted through Boarder.",
    inputSchema: { type: "object", properties: { calendarId: { type: "string" } }, required: ["calendarId"] },
    annotations: { destructiveHint: true },
    async run(call, a) {
      if (!a.calendarId || a.calendarId === "primary") return text("Pass the id of a calendar made with create_calendar.", true);
      const res = await call(`/calendars/${encodeURIComponent(String(a.calendarId))}`, { method: "DELETE" });
      return res.ok ? text("Deleted.") : asResult(res);
    },
  },
  {
    name: "list_events",
    description: "Events in a time range, soonest first (recurring events expanded). Defaults to the next 7 days of the primary calendar. `q` searches titles, descriptions, locations and attendees.",
    inputSchema: {
      type: "object",
      properties: {
        calendarId,
        timeMin: { type: "string", description: "From (RFC 3339), default now" },
        timeMax: { type: "string", description: "Until (RFC 3339), default 7 days after timeMin" },
        q: { type: "string", description: "Free-text search" },
        maxResults: { type: "number", description: "Default 50, up to 250" },
        pageToken: { type: "string" },
      },
    },
    annotations: { readOnlyHint: true },
    async run(call, a) {
      const from = a.timeMin ? String(a.timeMin) : new Date().toISOString();
      const until = a.timeMax ? String(a.timeMax) : new Date(Date.parse(from) + 7 * 86_400_000).toISOString();
      const res = await call(`/calendars/${cal(a.calendarId)}/events`, {
        query: { timeMin: from, timeMax: until, q: a.q, singleEvents: true, orderBy: "startTime", maxResults: Math.min(Number(a.maxResults) || 50, 250), pageToken: a.pageToken },
      });
      return asResult(res, (j) => ({ timeZone: j.timeZone, events: (j.items ?? []).map(slimEvent), ...(j.nextPageToken ? { nextPageToken: j.nextPageToken } : {}) }));
    },
  },
  {
    name: "get_event",
    description: "One event, in full.",
    inputSchema: { type: "object", properties: { calendarId, eventId: { type: "string" } }, required: ["eventId"] },
    annotations: { readOnlyHint: true },
    run: async (call, a) => asResult(await call(`/calendars/${cal(a.calendarId)}/events/${encodeURIComponent(String(a.eventId))}`)),
  },
  {
    name: "create_event",
    description: "Add an event. Invitations are emailed only with sendUpdates.",
    inputSchema: { type: "object", properties: { calendarId, ...eventFields }, required: ["summary", "start", "end"] },
    async run(call, a) {
      return asResult(await call(`/calendars/${cal(a.calendarId)}/events`, { method: "POST", query: { sendUpdates: a.sendUpdates ?? "none" }, body: eventBody(a) }), slimEvent);
    },
  },
  {
    name: "update_event",
    description: "Change an event: only the fields you pass change (attendees replaces the list).",
    inputSchema: { type: "object", properties: { calendarId, eventId: { type: "string" }, ...eventFields }, required: ["eventId"] },
    async run(call, a) {
      const path = `/calendars/${cal(a.calendarId)}/events/${encodeURIComponent(String(a.eventId))}`;
      return asResult(await call(path, { method: "PATCH", query: { sendUpdates: a.sendUpdates ?? "none" }, body: eventBody(a) }), slimEvent);
    },
  },
  {
    name: "delete_event",
    description: "Delete an event (cancellations are emailed only with sendUpdates).",
    inputSchema: { type: "object", properties: { calendarId, eventId: { type: "string" }, sendUpdates: eventFields.sendUpdates }, required: ["eventId"] },
    annotations: { destructiveHint: true },
    async run(call, a) {
      const res = await call(`/calendars/${cal(a.calendarId)}/events/${encodeURIComponent(String(a.eventId))}`, { method: "DELETE", query: { sendUpdates: a.sendUpdates ?? "none" } });
      return res.ok ? text("Deleted.") : asResult(res);
    },
  },
];

const CHANNEL_TALK = "https://api.channel.io";

const page = {
  cursor: { type: "string", description: "nextCursor from the previous page" },
  limit: { type: "number", description: "Default 25, up to 500" },
};
const range = (what: string) => ({
  from: { type: "number", description: `${what} from (Unix ms, inclusive); pass with to` },
  to: { type: "number", description: `${what} until (Unix ms, exclusive); pass with from` },
});
const full = { type: "boolean", description: "Return Channel Talk's whole records instead of the short form (for storing them)" };

/** A chat as agents need it, not Channel Talk's whole record. */
const slimChat = (c: any) => ({
  id: c.id,
  userId: c.userId,
  state: c.state,
  ...(c.name ? { name: c.name } : {}),
  ...(c.title ? { title: c.title } : {}),
  ...(c.description ? { description: String(c.description).slice(0, 500) } : {}),
  ...(c.tags?.length ? { tags: c.tags } : {}),
  ...(c.assigneeId ? { assigneeId: c.assigneeId } : {}),
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
  ...(c.closedAt ? { closedAt: c.closedAt } : {}),
});
const slimUser = (u: any) => ({
  id: u.id,
  ...(u.memberId ? { memberId: u.memberId } : {}),
  name: u.name ?? u.profile?.name,
  ...(u.email || u.profile?.email ? { email: u.email ?? u.profile?.email } : {}),
  ...(u.mobileNumber || u.profile?.mobileNumber ? { mobileNumber: u.mobileNumber ?? u.profile?.mobileNumber } : {}),
  ...(u.tags?.length ? { tags: u.tags } : {}),
});
/** personType: user (the customer), manager (a person on the team), bot. */
const slimMessage = (m: any) => ({
  id: m.id,
  createdAt: m.createdAt,
  personType: m.personType,
  personId: m.personId,
  ...(m.plainText ? { text: m.plainText } : {}),
  ...(m.files?.length ? { files: m.files.map((f: any) => ({ name: f.name ?? f.id, ...(f.key ? { key: f.key } : {}) })) } : {}),
  ...(m.log ? { log: m.log.action ?? m.log } : {}),
});
const cursorOf = (j: any) => (j.hasNext && j.nextCursor ? { nextCursor: j.nextCursor } : {});

const CHANNEL_TALK_TOOLS: ApiTool[] = [
  {
    name: "get_channel",
    description: "The Channel Talk channel (workspace) these keys belong to: its name and settings.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    run: async (call) => asResult(await call("/open/channel")),
  },
  {
    name: "list_chats",
    description:
      "Customer chats (user chats), newest first by default, with the customers in them. Filter by state (opened: waiting on the team, snoozed, closed) and a time range on when a chat last changed. Page with nextCursor to walk the whole history.",
    inputSchema: {
      type: "object",
      properties: {
        state: { type: "string", enum: ["opened", "snoozed", "closed", "queued", "initial", "missed"] },
        sortOrder: { type: "string", enum: ["desc", "asc"], description: "Default desc (newest first)" },
        ...range("Last changed"),
        ...page,
        full,
      },
    },
    annotations: { readOnlyHint: true },
    async run(call, a) {
      const res = await call("/open/user-chats", {
        query: { state: a.state, sortOrder: a.sortOrder, from: a.from, to: a.to, cursor: a.cursor, limit: Math.min(Number(a.limit) || 25, 500) },
      });
      return asResult(res, (j) => (a.full ? j : { chats: (j.userChats ?? []).map(slimChat), users: (j.users ?? []).map(slimUser), ...cursorOf(j) }));
    },
  },
  {
    name: "get_chat",
    description: "One chat, with its customer.",
    inputSchema: { type: "object", properties: { userChatId: { type: "string" }, full }, required: ["userChatId"] },
    annotations: { readOnlyHint: true },
    run: async (call, a) =>
      asResult(await call(`/open/user-chats/${encodeURIComponent(String(a.userChatId))}`), (j) =>
        a.full ? j : { chat: j.userChat ? slimChat(j.userChat) : undefined, user: j.user ? slimUser(j.user) : undefined },
      ),
  },
  {
    name: "list_messages",
    description: "Messages in a chat, oldest first by default. personType tells who wrote each: user (the customer), manager (the team), bot.",
    inputSchema: {
      type: "object",
      properties: { userChatId: { type: "string" }, sortOrder: { type: "string", enum: ["asc", "desc"], description: "Default asc (oldest first)" }, ...range("Sent"), ...page, full },
      required: ["userChatId"],
    },
    annotations: { readOnlyHint: true },
    async run(call, a) {
      const res = await call(`/open/user-chats/${encodeURIComponent(String(a.userChatId))}/messages`, {
        query: { sortOrder: a.sortOrder ?? "asc", from: a.from, to: a.to, cursor: a.cursor, limit: Math.min(Number(a.limit) || 25, 500) },
      });
      return asResult(res, (j) => (a.full ? j : { messages: (j.messages ?? []).map(slimMessage), ...cursorOf(j) }));
    },
  },
  {
    name: "get_file_url",
    description:
      "A download link for a file sent in a chat (a photo, a PDF), by its key from list_messages (files[].key). The link works for 15 minutes and needs no Channel Talk keys.",
    inputSchema: { type: "object", properties: { userChatId: { type: "string" }, key: { type: "string", description: "files[].key from list_messages" } }, required: ["userChatId", "key"] },
    annotations: { readOnlyHint: true },
    async run(call, a) {
      if (!String(a.key ?? "").trim()) return text("key is empty: take it from list_messages (files[].key).", true);
      const res = await call(`/open/user-chats/${encodeURIComponent(String(a.userChatId))}/messages/file`, { query: { key: String(a.key) } });
      return asResult(res, (j) => ({ url: j.result }));
    },
  },
  {
    name: "get_user",
    description: "A customer (user) by id: name, contact, tags.",
    inputSchema: { type: "object", properties: { userId: { type: "string" }, full }, required: ["userId"] },
    annotations: { readOnlyHint: true },
    run: async (call, a) => asResult(await call(`/open/users/${encodeURIComponent(String(a.userId))}`), (j) => (a.full ? j : j.user ? slimUser(j.user) : j)),
  },
  {
    name: "list_user_chats",
    description: "All chats of one customer, for their history.",
    inputSchema: { type: "object", properties: { userId: { type: "string" }, ...page, full }, required: ["userId"] },
    annotations: { readOnlyHint: true },
    async run(call, a) {
      const res = await call(`/open/users/${encodeURIComponent(String(a.userId))}/user-chats`, { query: { cursor: a.cursor, limit: Math.min(Number(a.limit) || 25, 500) } });
      return asResult(res, (j) => (a.full ? j : { chats: (j.userChats ?? []).map(slimChat), ...cursorOf(j) }));
    },
  },
  {
    name: "list_managers",
    description: "The team's managers (people who answer chats), with ids that appear as personId on their messages.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    run: async (call) => asResult(await call("/open/managers", { query: { limit: 500 } }), (j) => (j.managers ?? []).map((m: any) => ({ id: m.id, name: m.name, email: m.email }))),
  },
  {
    name: "list_chat_tags",
    description: "The chat tags defined in the channel.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    run: async (call) => asResult(await call("/open/chat-tags", { query: { limit: 500 } }), (j) => (j.chatTags ?? []).map((t: any) => ({ id: t.id, name: t.name, description: t.description }))),
  },
  {
    name: "send_message",
    description:
      "Send a message to the customer in a chat. The customer sees it at once and it can't be taken back: only send text the user has approved word for word, never a draft.",
    inputSchema: {
      type: "object",
      properties: {
        userChatId: { type: "string" },
        text: { type: "string", description: "The approved message, as plain text" },
        botName: { type: "string", description: "Sender name the customer sees (up to 30 characters), e.g. the team's name" },
      },
      required: ["userChatId", "text", "botName"],
    },
    annotations: { destructiveHint: true, openWorldHint: true },
    async run(call, a) {
      if (!String(a.text ?? "").trim()) return text("text is empty.", true);
      const res = await call(`/open/user-chats/${encodeURIComponent(String(a.userChatId))}/messages`, {
        method: "POST",
        query: { botName: String(a.botName ?? "").slice(0, 30) },
        body: { blocks: [{ type: "text", value: String(a.text) }] },
      });
      return asResult(res, (j) => (j.message ? slimMessage(j.message) : j));
    },
  },
];

// ── Boarder: 목록 · 키 · 부르기 ──
const SLACK = "https://slack.com/api";

/** Slack answers 200 with {ok:false, error}: an error result, with the scope it wanted if that's why. */
async function slackResult(res: Response, pick: (j: any) => unknown): Promise<CallResult> {
  const j = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; needed?: string } | null;
  if (!j) return text(`${res.status} ${res.statusText}`, true);
  if (!j.ok) {
    const why = j.error === "ratelimited" ? " (Slack allows apps outside its Marketplace one history read a minute: search_messages instead, or try again in a minute)" : j.needed ? ` (needs the ${j.needed} permission: connect Slack again)` : "";
    return text(`Slack: ${j.error ?? "error"}${why}`, true);
  }
  return text(JSON.stringify(pick(j), null, 1));
}
const slackMessage = (m: any) => ({ ts: m.ts, user: m.user ?? m.username ?? m.bot_id, text: m.text, ...(m.thread_ts ? { thread_ts: m.thread_ts } : {}), ...(m.reply_count ? { replies: m.reply_count } : {}), ...(m.files?.length ? { files: m.files.map((f: any) => f.name) } : {}) });
const channelArg = { type: "string", description: "Channel id (C…, G…, D…) from list_channels or search_messages" };
const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };

const SLACK_TOOLS: ApiTool[] = [
  {
    name: "search_messages",
    title: "Search Slack messages",
    description: 'Search messages the user can see (public and private channels, DMs, group DMs) by words or a question, e.g. "launch date decision". Returns matches with their channel, author, time and permalink.',
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        sort: { type: "string", enum: ["score", "timestamp"], description: "Best match (default) or newest first" },
        after: { type: "string", description: "Only after this date (YYYY-MM-DD)" },
        before: { type: "string", description: "Only before this date (YYYY-MM-DD)" },
        limit: { type: "number", description: "Default 20, up to 20" },
        cursor: { type: "string", description: "next_cursor from the previous page" },
      },
      required: ["query"],
    },
    annotations: readOnly,
    async run(call, a) {
      const day = (d: unknown) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? Math.floor(Date.parse(`${d}T00:00:00Z`) / 1000) : undefined);
      const res = await call("assistant.search.context", {
        method: "POST",
        body: {
          query: a.query,
          content_types: ["messages"],
          channel_types: ["public_channel", "private_channel", "mpim", "im"],
          sort: a.sort === "timestamp" ? "timestamp" : "score",
          limit: Math.min(Number(a.limit) || 20, 20),
          ...(day(a.after) ? { after: day(a.after) } : {}),
          ...(day(a.before) ? { before: day(a.before) } : {}),
          ...(a.cursor ? { cursor: a.cursor } : {}),
        },
      });
      const first = (await res.clone().json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      // Slack opens that search only to AI apps it has enabled: otherwise the classic search (search:read).
      if (first && !first.ok && ["feature_not_enabled", "not_allowed_token_type", "access_denied"].includes(first.error ?? "")) {
        const words = [String(a.query ?? ""), typeof a.after === "string" && a.after ? `after:${a.after}` : "", typeof a.before === "string" && a.before ? `before:${a.before}` : ""].filter(Boolean).join(" ");
        const classic = await call("search.messages", { query: { query: words, count: Math.min(Number(a.limit) || 20, 100), sort: a.sort === "timestamp" ? "timestamp" : "score", page: a.cursor } });
        return slackResult(classic, (j) => ({
          total: j.messages?.total,
          matches: (j.messages?.matches ?? []).map((m: any) => ({ channel: m.channel?.id, channel_name: m.channel?.name, user: m.username ?? m.user, ts: m.ts, text: m.text, permalink: m.permalink })),
          ...(j.messages?.paging?.page < j.messages?.paging?.pages ? { next_cursor: String(j.messages.paging.page + 1) } : {}),
        }));
      }
      return slackResult(res, (j) => ({
        matches: (j.results?.messages ?? []).map((m: any) => ({ channel: m.channel_id, channel_name: m.channel_name, user: m.author_name ?? m.author_user_id, ts: m.message_ts, text: m.content, permalink: m.permalink })),
        next_cursor: j.response_metadata?.next_cursor || undefined,
      }));
    },
  },
  {
    name: "list_channels",
    title: "List Slack channels",
    description: "Channels, private channels and direct messages the user is in, with their ids (for read_channel and send_message).",
    inputSchema: { type: "object", properties: { types: { type: "string", description: "Comma-separated: public_channel, private_channel, mpim, im. Default all" }, cursor: { type: "string", description: "next_cursor from the previous page" } } },
    annotations: readOnly,
    async run(call, a) {
      const res = await call("users.conversations", { query: { types: a.types ?? "public_channel,private_channel,mpim,im", limit: 200, exclude_archived: true, cursor: a.cursor } });
      return slackResult(res, (j) => ({
        channels: (j.channels ?? []).map((c: any) => ({ id: c.id, name: c.name ?? (c.is_im ? `dm:${c.user}` : undefined), private: c.is_private || undefined, dm: c.is_im || c.is_mpim || undefined })),
        next_cursor: j.response_metadata?.next_cursor || undefined,
      }));
    },
  },
  {
    name: "read_channel",
    title: "Read a Slack channel",
    description: "Recent messages in a channel, newest first (up to 15 a call). Slack allows this about once a minute for 0bridge's app until it's in the Slack Marketplace, so search_messages is better for finding something.",
    inputSchema: { type: "object", properties: { channel: channelArg, oldest: { type: "string", description: "Only after this ts" }, latest: { type: "string", description: "Only before this ts" }, cursor: { type: "string" } }, required: ["channel"] },
    annotations: readOnly,
    async run(call, a) {
      const res = await call("conversations.history", { query: { channel: a.channel, limit: 15, oldest: a.oldest, latest: a.latest, cursor: a.cursor } });
      return slackResult(res, (j) => ({ messages: (j.messages ?? []).map(slackMessage), next_cursor: j.response_metadata?.next_cursor || undefined }));
    },
  },
  {
    name: "read_thread",
    title: "Read a Slack thread",
    description: "A message and its replies, by the channel and the parent message's ts (thread_ts).",
    inputSchema: { type: "object", properties: { channel: channelArg, ts: { type: "string", description: "The parent message's ts" }, cursor: { type: "string" } }, required: ["channel", "ts"] },
    annotations: readOnly,
    async run(call, a) {
      const res = await call("conversations.replies", { query: { channel: a.channel, ts: a.ts, limit: 15, cursor: a.cursor } });
      return slackResult(res, (j) => ({ messages: (j.messages ?? []).map(slackMessage), next_cursor: j.response_metadata?.next_cursor || undefined }));
    },
  },
  {
    name: "get_user",
    title: "Look up a Slack user",
    description: "A person's name, title, time zone and email, by their user id (U…) or email.",
    inputSchema: { type: "object", properties: { user: { type: "string", description: "User id" }, email: { type: "string" } } },
    annotations: readOnly,
    async run(call, a) {
      if (!a.user && !a.email) return text("Pass user (an id) or email.", true);
      const res = a.user ? await call("users.info", { query: { user: a.user } }) : await call("users.lookupByEmail", { query: { email: a.email } });
      return slackResult(res, (j) => {
        const u = j.user ?? {};
        return { id: u.id, name: u.name, real_name: u.real_name, title: u.profile?.title || undefined, email: u.profile?.email, tz: u.tz, deleted: u.deleted || undefined };
      });
    },
  },
  {
    name: "send_message",
    title: "Send a Slack message",
    description: "Post a message as the user, in a channel or a DM, or as a reply in a thread (thread_ts). Others see it right away.",
    inputSchema: { type: "object", properties: { channel: channelArg, text: { type: "string", description: "Message text (Slack mrkdwn)" }, thread_ts: { type: "string", description: "Reply in this thread" } }, required: ["channel", "text"] },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    async run(call, a) {
      const res = await call("chat.postMessage", { method: "POST", body: { channel: a.channel, text: a.text, ...(a.thread_ts ? { thread_ts: a.thread_ts } : {}) } });
      return slackResult(res, (j) => ({ channel: j.channel, ts: j.ts }));
    },
  },
  {
    name: "add_reaction",
    title: "React to a Slack message",
    description: 'Add an emoji reaction as the user, by the channel, the message ts and the emoji name without colons ("eyes").',
    inputSchema: { type: "object", properties: { channel: channelArg, ts: { type: "string" }, name: { type: "string" } }, required: ["channel", "ts", "name"] },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    async run(call, a) {
      const res = await call("reactions.add", { method: "POST", body: { channel: a.channel, timestamp: a.ts, name: String(a.name ?? "").replace(/:/g, "") } });
      return slackResult(res, () => ({ ok: true }));
    },
  },
];

const SLACK_USER_SCOPES = ["search:read.public", "search:read.private", "search:read.im", "search:read.mpim", "channels:read", "groups:read", "im:read", "mpim:read", "channels:history", "groups:history", "im:history", "mpim:history", "users:read", "users:read.email", "chat:write", "reactions:write"];

const GITHUB_API = "https://api.github.com";
const GITHUB_TOOLS: ApiTool[] = [
  {
    name: "list_repos",
    title: "List repositories the GitHub app can see",
    description: "Every repository the user picked when installing the GitHub app (their own and their organizations'), newest push first, with private/public and the owner.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async run(call) {
      const inst = await call("/user/installations", { query: { per_page: 100 } });
      if (!inst.ok) return asResult(inst);
      const { installations = [] } = await inst.json() as { installations?: { id: number; account: { login: string } }[] };
      const repos: { repo: string; private: boolean; owner: string; pushed_at: string | null; url: string }[] = [];
      for (const i of installations) {
        for (let page = 1; page <= 20; page++) {
          const r = await call(`/user/installations/${i.id}/repositories`, { query: { per_page: 100, page } });
          if (!r.ok) break;
          const j = await r.json() as { repositories: { full_name: string; private: boolean; owner: { login: string }; pushed_at: string | null; html_url: string }[]; total_count: number };
          for (const x of j.repositories) repos.push({ repo: x.full_name, private: x.private, owner: x.owner.login, pushed_at: x.pushed_at, url: x.html_url });
          if (page * 100 >= j.total_count) break;
        }
      }
      repos.sort((a, b) => (b.pushed_at ?? "").localeCompare(a.pushed_at ?? ""));
      return text(JSON.stringify({ accounts: installations.map(i => i.account.login), repos }, null, 1));
    },
  },
  ...requestTools(GITHUB_API).filter(t => t.name === "get"),
];
export function githubApp(env: AppEnv, auth: ApiAuth): { client_id: string; client_secret: string } | null {
  if (auth.type !== "oauth" || auth.provider !== "github") return null;
  const id = str(env, "GITHUB_APP_CLIENT_ID"), secret = str(env, "GITHUB_APP_CLIENT_SECRET");
  return id && secret ? { client_id: id, client_secret: secret } : null;
}
export async function githubAppToken(client: { client_id: string; client_secret: string }, refresh_token: string): Promise<{ access_token: string; refresh_token?: string; expires_at: number }> {
  const res = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ ...client, grant_type: "refresh_token", refresh_token }), signal: AbortSignal.timeout(15_000) });
  const j = await res.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
  // GitHub 은 200 + error 로 거절 — 갱신 토큰을 거절한 때만 400(「다시 연결」)
  if (!j.access_token) throw new GoogleTokenError(`GitHub 토큰 갱신 실패: ${j.error || res.status}`, j.error === "bad_refresh_token" ? 400 : 503, j.error);
  return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in ?? 28_800) * 1000 };
}

const GMAIL_VIA_IMAP = "메일(IMAP)로 연결해요 — 서버 imap.gmail.com · 구글 앱 비밀번호(구글 계정 › 보안 › 2단계 인증 › 앱 비밀번호)";
export const API_PRESETS: Record<string, { title: string; spec: ApiSpec; tools: ApiTool[]; ready: boolean; note?: string; plain?: number; hints?: string[] }> = {
  channeltalk: { title: "채널톡", ready: true, spec: { preset: "channeltalk", baseUrl: CHANNEL_TALK, auth: { type: "headers", names: ["x-access-key", "x-access-secret"] }, headers: { "Channel-Version": "2026-06-01" } }, tools: CHANNEL_TALK_TOOLS,
    note: "채널 데스크 › 설정 › API 키 관리의 키 두 개" },
  "google-calendar": { title: "구글 캘린더", ready: false, spec: { preset: "google-calendar", baseUrl: CAL,
    auth: { type: "oauth", provider: "google", scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.app.created" } },
    tools: GOOGLE_CALENDAR_TOOLS, note: "구글이 「확인되지 않은 앱」을 보여 주면 「고급 › 보더(으)로 이동」" },
  gmail: { title: "Gmail", ready: false, spec: { preset: "gmail", baseUrl: GMAIL, auth: { type: "oauth", provider: "google", scope: GMAIL_SCOPE, app: "gmail" } }, tools: GMAIL_READ_TOOLS,
    note: "테스트 사용자만 · 7일마다 다시 연결 · 「확인되지 않은 앱」 화면에서 「계속」 · 읽기만 — 늘 쓰려면 메일(IMAP) + 구글 앱 비밀번호" },
  "github-app": { title: "GitHub 앱", ready: false, spec: { preset: "github-app", baseUrl: GITHUB_API, auth: { type: "oauth", provider: "github", scope: "" }, headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "boarder" } }, tools: GITHUB_TOOLS,
    note: "0b 에서 옮긴 GitHub 앱 로그인 — 저장소 목록 읽기" },
  // 키 세 줄 중 앞 둘(서버 · 주소)은 비밀이 아님 — 설정 칸에서 보이게(plain), 칸 안 예시(hints)
  imap: { title: "메일(IMAP)", ready: true, spec: { preset: "imap", baseUrl: "imaps://mail", auth: { type: "imap" } }, tools: IMAP_TOOLS, plain: 2,
    hints: ["imap.gmail.com", "me@gmail.com", "구글 앱 비밀번호 16자"],
    note: "Gmail 은 서버 imap.gmail.com + 구글 앱 비밀번호(구글 계정 › 보안 › 2단계 인증 › 앱 비밀번호) · 읽기만" },
  slack: { title: "Slack", ready: false, spec: { preset: "slack", baseUrl: SLACK, auth: { type: "oauth", provider: "slack", scope: SLACK_USER_SCOPES.join(",") } }, tools: SLACK_TOOLS, note: "Slack 로그인 앱 준비 중" },
};
export const toolsFor = (spec: ApiSpec): ApiTool[] => (spec.preset && API_PRESETS[spec.preset]?.tools) || requestTools(spec.baseUrl);
const fixedHeaders = (spec: ApiSpec): Record<string, string> => (spec.preset && API_PRESETS[spec.preset]?.spec.headers) || spec.headers || {};

export function parseAuth(raw: unknown): ApiAuth | null {
  const a = raw as { type?: string; name?: string } | undefined;
  const name = typeof a?.name === "string" ? a.name.trim() : "";
  switch (a?.type) {
    case "bearer": case "basic": return { type: a.type };
    case "header": return /^[A-Za-z0-9-]{1,64}$/.test(name) && !/^(host|content-length|cookie)$/i.test(name) ? { type: "header", name } : null;
    case "query": return /^[A-Za-z0-9_.-]{1,64}$/.test(name) ? { type: "query", name } : null;
    default: return null;
  }
}
/** 사람이 넣을 키 이름(설정 칸) */
export function keyNames(auth: ApiAuth): string[] {
  switch (auth.type) {
    case "headers": return auth.names;
    case "header": case "query": return [auth.name];
    case "basic": return ["user:password"];
    case "bearer": return ["API key"];
    case "imap": return ["IMAP 서버(예: imap.gmail.com)", "메일 주소", "앱 비밀번호"];
    default: return [];
  }
}
/** 키 검사: headers 꼴은 줄마다 하나, 다 있어야 */
export function checkKey(auth: ApiAuth, key: unknown): { key: string } | { error: string } {
  if (typeof key !== "string" || !key.trim() || key.length > 8192) return { error: "키를 넣어요(8 KB 까지)" };
  if (auth.type === "imap") {
    const l = imapLogin(key.trim());
    return "error" in l ? l : { key: `${l.host}${l.port === 993 ? "" : `:${l.port}`}\n${l.user}\n${l.password}` };
  }
  if (auth.type !== "headers") return { key: key.trim() };
  const parts = key.trim().split("\n").map(x => x.trim());
  if (parts.length !== auth.names.length || parts.some(x => !x)) return { error: `키 ${auth.names.length}개(${auth.names.join(", ")}), 줄마다 하나` };
  return { key: parts.join("\n") };
}
export const keyParts = (auth: ApiAuth, key?: string): string[] => {
  if (!key) return [];
  const pw = auth.type === "imap" ? key.split("\n").slice(2).join("\n") : "";
  const raw = auth.type === "headers" ? key.split("\n") : auth.type === "basic" ? [key, btoa(key), key.slice(key.indexOf(":") + 1)] : auth.type === "imap" ? (pw ? [pw, pw.replace(/\s+/g, "")] : []) : [key];
  return [...new Set(raw.flatMap(v => [v, encodeURIComponent(v), new URLSearchParams({ k: v }).toString().slice(2), JSON.stringify(v).slice(1, -1)]))];
};
const OVERRIDE = /^x-(http-)?method(-override)?$/i;
function authorize(auth: ApiAuth, key: string, headers: Headers, url: URL) {
  switch (auth.type) {
    case "bearer": headers.set("Authorization", `Bearer ${key}`); break;
    case "basic": headers.set("Authorization", `Basic ${btoa(key)}`); break;
    case "header": headers.set(auth.name, key); break;
    case "query": url.searchParams.set(auth.name, key); break;
    case "headers": { const v = key.split("\n"); auth.names.forEach((n, i) => headers.set(n, v[i] ?? "")); break; }
    case "oauth": headers.set("Authorization", `Bearer ${key}`); break;
  }
}
export async function runApi(spec: ApiSpec, key: string | undefined, name: string, args: Record<string, unknown>): Promise<CallResult> {
  const tool = toolsFor(spec).find(t => t.name === name);
  if (!tool) return text(`없는 도구 ${name}`, true);
  if (!key) return text("이 연결에 키가 없어요 — 보더 설정 › 커넥터에서 키를 넣어요", true);
  const secrets = [...keyParts(spec.auth, key), ...(spec.preset ? [] : Object.values(spec.headers || {}))].filter(v => v.length >= 6).sort((a, b) => b.length - a.length);
  const call: ApiFetch = async (path, init = {}) => {
    const url = under(spec.baseUrl, path);
    for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    const headers = new Headers(init.headers ?? {}), method = (init.method ?? "GET").toUpperCase();
    if (method === "GET" || method === "HEAD") for (const k of [...headers.keys()]) if (OVERRIDE.test(k)) headers.delete(k);
    for (const [k, v] of Object.entries(fixedHeaders(spec))) headers.set(k, v);
    const json = init.body !== undefined && typeof init.body !== "string";
    if (json) headers.set("Content-Type", "application/json");
    authorize(spec.auth, key, headers, url);
    return fetch(url, { method, headers, body: init.body === undefined ? undefined : json ? JSON.stringify(init.body) : String(init.body), redirect: "manual", signal: AbortSignal.timeout(30_000) });
  };
  // 메일(IMAP)은 call(HTTP) 대신 키의 서버로 소켓을 엶 — 도구가 부를 때만, 부를 때마다 로그인 · 로그아웃
  const imap: OpenImap | undefined = spec.auth.type === "imap" ? () => {
    const login = imapLogin(key);
    if ("error" in login) throw new Error(login.error);
    return openImap(login);
  } : undefined;
  try {
    const r = await tool.run(call, args, { imap });
    return { ...r, content: r.content.map(c => ({ ...c, text: secrets.reduce((t, s) => t.split(s).join("***"), c.text) })) };
  } catch (e) { return text(secrets.reduce((t, s) => t.split(s).join("***"), e instanceof Error ? e.message : String(e)), true); }
}

type AppEnv = Record<string, unknown>;
const str = (env: AppEnv, k: string) => typeof env[k] === "string" ? env[k] as string : "";
/** 그 API 의 구글 앱(client). 없으면 null */
export function googleApp(env: AppEnv, auth: ApiAuth): { client_id: string; client_secret: string } | null {
  if (auth.type !== "oauth" || auth.provider !== "google") return null;
  const [id, secret] = auth.app === "gmail" ? [str(env, "GMAIL_CLIENT_ID"), str(env, "GMAIL_CLIENT_SECRET")] : [str(env, "GOOGLE_CLIENT_ID"), str(env, "GOOGLE_CLIENT_SECRET")];
  return id && secret ? { client_id: id, client_secret: secret } : null;
}
const gmailTester = (env: AppEnv, email: string) => str(env, "GMAIL_TEST_USERS").split(",").map(x => x.trim().toLowerCase()).filter(Boolean).includes(email.trim().toLowerCase());
/** 지금 이 사람이 연결할 수 있는지: 키 API 는 늘, 구글 로그인 API 는 그 앱이 있을 때(Gmail 은 테스트 사용자만 — 그 밖은 via 「imap」). soon = 「곧」 */
export function apiReady(env: AppEnv, service: string, email: string): { ready: boolean; soon?: boolean; oauth?: boolean; note?: string; via?: string } {
  const p = API_PRESETS[service]; if (!p) return { ready: false };
  const a = p.spec.auth;
  if (a.type !== "oauth") return { ready: p.ready, note: p.note };
  // Gmail 테스트 사용자가 아니면 「곧」 대신 메일(IMAP)로 — via = 화면이 그 커넥터 키 칸을 엶
  if (a.app === "gmail" && (!googleApp(env, a) || !gmailTester(env, email))) return { ready: false, oauth: true, via: "imap", note: GMAIL_VIA_IMAP };
  if (a.provider !== "google" || !googleApp(env, a) || !p.tools.length) return { ready: false, oauth: true, note: p.note };
  return { ready: true, oauth: true, note: p.note };
}

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export function googleAuthUrl(client: { client_id: string }, redirectUri: string, state: string, scope: string): string {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.search = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirectUri, response_type: "code", scope, state, access_type: "offline", prompt: "consent" }).toString();
  return u.href;
}
export function slackApp(env: AppEnv, auth: ApiAuth): { client_id: string; client_secret: string } | null {
  if (auth.type !== "oauth" || auth.provider !== "slack") return null;
  const id = str(env, "SLACK_CLIENT_ID"), secret = str(env, "SLACK_CLIENT_SECRET");
  return id && secret ? { client_id: id, client_secret: secret } : null;
}
export async function slackToken(client: { client_id: string; client_secret: string }, refresh_token: string): Promise<{ access_token: string; refresh_token?: string; expires_at: number }> {
  const res = await fetch("https://slack.com/api/oauth.v2.access", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...client, grant_type: "refresh_token", refresh_token }), signal: AbortSignal.timeout(15_000) });
  const j = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; access_token?: string; refresh_token?: string; expires_in?: number; authed_user?: { access_token?: string; refresh_token?: string; expires_in?: number } };
  const u = j.authed_user?.access_token ? j.authed_user : j;
  // Slack 은 200 + ok:false 로 거절함 — 400 으로 바꿔 「다시 연결」 판정(googleKey)에 태움
  // 갱신 토큰 자체를 거절한 때만 400(「다시 연결」) — 한도 · 일시 오류 · 앱 설정 오류는 5xx 로 넘겨 「오류」(다음에 다시)
  const dead = /^(invalid_refresh_token|invalid_grant|token_revoked|token_expired|invalid_auth|account_inactive)$/.test(j.error || "");
  if (!j.ok || !u.access_token) throw new GoogleTokenError(`Slack 토큰 갱신 실패: ${j.error || res.status}`, dead ? 400 : res.status === 429 ? 429 : 503, j.error);
  return { access_token: u.access_token, refresh_token: u.refresh_token, expires_at: Date.now() + (u.expires_in ?? 43_200) * 1000 };
}
export class GoogleTokenError extends Error { constructor(m: string, public status: number, public code?: string) { super(m); } }
/** 코드 · 갱신 토큰을 구글 토큰 주소에서 바꿈(값은 안 찍음) */
export async function googleToken(client: { client_id: string; client_secret: string }, params: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_at: number; scope?: string }> {
  const res = await fetch(GOOGLE_TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...client, ...params }), signal: AbortSignal.timeout(15_000) });
  const j = await res.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string; error_description?: string };
  if (!res.ok || !j.access_token) throw new GoogleTokenError(`구글 로그인 실패: ${j.error_description || j.error || res.status}`, res.status, j.error);
  return { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in ?? 3600) * 1000, scope: j.scope };
}
export async function googleAccountOf(spec: ApiSpec, accessToken: string): Promise<string> {
  const url = spec.preset === "gmail" ? `${GMAIL}/profile` : `${CAL}/users/me/calendarList/primary?fields=id`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10_000) }).catch(() => null);
  const j = res?.ok ? await res.json().catch(() => ({})) as { emailAddress?: string; id?: string } : {};
  const v = j.emailAddress || j.id || "";
  return v.includes("@") ? v.slice(0, 120) : "";
}
