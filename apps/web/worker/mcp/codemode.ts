export type Tool = { name: string; title?: string; description: string; inputSchema: Record<string, unknown>; annotations?: Record<string, boolean> };

export const SEARCH = "boarder_search";
export const DESCRIBE = "boarder_describe";
export const EXECUTE = "boarder_execute";
export const EXECUTE_WRITE = "boarder_execute_write";

export const MAX_CALLS = 50;
export const MAX_CODE = 20_000;
export const MAX_OUTPUT = 40_000;
export const TIMEOUT_MS = 60_000;

const SCRIPT = `JavaScript: an async arrow function, e.g. \`async () => { const c = await tools.call("inbox_ask", { question: "…", choices: ["A: …", "B: …"] }); return c; }\`, or just its body. In it, \`await tools.call(name, args)\` runs a tool and returns its result (an error throws), \`await tools.search(query)\` and \`await tools.describe(name)\` do what ${SEARCH} and ${DESCRIBE} do, and \`input\` is the input given with it. Return what you need: only the returned value and console.log lines come back. No network, at most ${MAX_CALLS} tool calls, ${TIMEOUT_MS / 1000} seconds.`;

const executeSchema = (what: string) => ({
  type: "object",
  properties: {
    tool: { type: "string", description: `One tool to run, by the name ${SEARCH} gave (e.g. inbox_log). Leave out to run a script or calls instead.` },
    arguments: { type: "object", description: "That tool's arguments, as boarder_describe shows its input schema" },
    calls: {
      type: "array", maxItems: MAX_CALLS,
      description: `Several ${what} that need no logic between them, run one after another: [{"tool": name, "arguments": {...}, "key"?: "a"}]. Returns {key (or index): result}; a call that fails comes back as "ERROR …" under its key and the rest still run.`,
      items: { type: "object", properties: { tool: { type: "string" }, arguments: { type: "object" }, key: { type: "string" } }, required: ["tool"] },
    },
    code: { type: "string", description: `A script that runs several ${what} and combines their results. ${SCRIPT}` },
    input: { description: "With code: any JSON the script reads as `input`." },
  },
});

export const CODE_TOOLS: Tool[] = [
  {
    name: SEARCH, title: "Find Boarder tools",
    description: "Search by keywords the tools an agent has in Boarder: the human's inbox (ask the human a decision, wait for the answer, log progress, close a card, post in a thread, set your status line) and the services the human connected in Boarder settings, named <service>__<tool> (e.g. linear__list_issues, or github__dgit__… for a second account). Returns tool names with a line each and which tool runs each: boarder_execute for one that only reads, boarder_execute_write for one that changes something.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Keywords (e.g. `ask decision`, `log progress`)" }, limit: { type: "number", description: "How many to return (default 10, at most 25)" } }, required: ["query"] },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: DESCRIBE, title: "Describe a Boarder tool",
    description: "A tool found with boarder_search in full: what it does, its input schema, whether it only reads, and which tool runs it.",
    inputSchema: { type: "object", properties: { name: { type: "string", description: "The tool's name as boarder_search gave it, e.g. inbox_ask" } }, required: ["name"] },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: EXECUTE, title: "Run Boarder tools that only read",
    description: `Run tools found with boarder_search that only read (waiting for an answer): one by name with its arguments, or several from a short script. A tool that changes something is refused here: run it with ${EXECUTE_WRITE}.`,
    inputSchema: executeSchema("read-only tools"),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  {
    name: EXECUTE_WRITE, title: "Run Boarder tools that change something",
    description: "Run tools found with boarder_search, including ones that change something (asking the human, logging, closing a card, posting): one by name with its arguments, or several from a short script.",
    inputSchema: executeSchema("tools"),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
];

export const INSTRUCTIONS = `Boarder is the human's inbox for agents. It lists four tools; the inbox tools (inbox_ask, inbox_wait, inbox_log, inbox_close, inbox_say, inbox_status) are found with ${SEARCH}, read with ${DESCRIBE}, and run with ${EXECUTE} (reads) or ${EXECUTE_WRITE} (changes). Services the human connected (Linear, GitHub, Notion, …) are found the same way as <service>__<tool>. Ask the human only what only they can decide, one line, recommendation first; log progress instead of asking; close your card when you've acted on the answer.`;

/** 스크립트가 보는 도구 결과: 구조 값 그대로(Boarder 도구는 JSON 만 돌려줌) */
export interface ToolApi {
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
  search(query: string, limit?: number): Promise<unknown>;
  describe(name: string): Promise<unknown>;
}
export interface ScriptResult { result?: unknown; error?: string; logs: string[] }
export type Sandbox = (code: string, api: ToolApi, input?: unknown, caller?: string) => Promise<ScriptResult>;

export function functionSource(code: string): string {
  const c = code.trim();
  return /^async\b/.test(c) ? c : `async () => {\n${c}\n}`;
}

export function formatScript(r: ScriptResult, calls: number): { text: string; isError: boolean } {
  const parts: string[] = [];
  if (r.error !== undefined) parts.push(`Error: ${r.error}`);
  else parts.push(typeof r.result === "string" ? r.result : JSON.stringify(r.result ?? null, null, 2));
  if (r.logs.length) parts.push(`console:\n${r.logs.join("\n")}`);
  parts.push(`(${calls} tool call${calls === 1 ? "" : "s"})`);
  return { text: parts.join("\n\n"), isError: r.error !== undefined };
}
