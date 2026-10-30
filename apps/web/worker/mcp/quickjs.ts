import variant from "@jitl/quickjs-wasmfile-release-sync";
import wasm from "../../node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm?module";
import { newQuickJSWASMModuleFromVariant, newVariant, type QuickJSContext, type QuickJSHandle } from "quickjs-emscripten-core";
import { functionSource, TIMEOUT_MS, type Sandbox, type ScriptResult } from "./codemode";

/**
 * One run's wasm memory, fixed: it never grows. (quickjs-emscripten keeps views of the memory that
 * a growth detaches: past its first 16 MB, calls failed with "ArrayBuffer has been detached".)
 */
const WASM_PAGES = 256; // 16 MB, the build's own starting size
/** The interpreter's heap within it; the rest is its stack and static data. */
export const MEMORY_LIMIT = 12 * 1024 * 1024;
/** Its stack: deep recursion fails as a RangeError instead of overrunning the wasm stack. */
const STACK_LIMIT = 512 * 1024;
export const CPU_CHECKS = 75_000;
/** Runs at once in one isolate, and of those one caller's. */
export const MAX_RUNS = 4;
export const PER_CALLER = 2;
/** Promise jobs run between looks at whether the run is over. */
const JOB_BATCH = 64;
/**
 * Promise jobs cost the budget too: a chain of them barely moves QuickJS's own counter (10,000
 * checks took 34 s of jobs in workerd), and the host runs them in one go, where no timer can stop it.
 * workerd ran ~400,000 jobs a second and ~13,000 checks; at 20 jobs a check, a chain of jobs stops in about 5 s.
 */
const JOBS_PER_CHECK = 20;
/** Longest strings taken from the script: a log line (cut), a tool name, a search, a tool's arguments and the result (refused). */
const MAX_LINE = 2000;
const MAX_NAME = 500;
const MAX_QUERY = 2000;
const MAX_ARGS = 1_000_000;
const MAX_RESULT = 1_000_000;

const COMPUTED = "The script computed for too long and was stopped.";
const MEMORY = "The script used too much memory and was stopped.";

let running = 0;
const runsOf = new Map<string, number>();
let waiting: (() => void)[] = [];
const free = (caller: string) => running < MAX_RUNS && (runsOf.get(caller) ?? 0) < PER_CALLER;

/** A fresh QuickJS instance: the compiled module is shared, its memory is not. */
const instance = () =>
  newQuickJSWASMModuleFromVariant(newVariant(variant, { wasmModule: wasm, wasmMemory: async () => new WebAssembly.Memory({ initial: WASM_PAGES, maximum: WASM_PAGES }) }));

/** In the interpreter: hands the script `tools`, `console` and `input`, and reports how it ended through `done`. */
const RUNNER = `(function (call, search, describe, log, done) {
  const show = (x) => { if (typeof x === "string") return x; try { return JSON.stringify(x); } catch (e) { return String(x); } };
  const line = (...a) => log(a.map(show).join(" "));
  const console = Object.freeze({ log: line, info: line, warn: line, error: line, debug: line });
  const tools = Object.freeze({
    call: (name, args) => call(String(name), JSON.stringify(args && typeof args === "object" ? args : {})),
    search: (query, limit) => search(String(query), limit === undefined ? -1 : Number(limit)),
    describe: (name) => describe(String(name)),
  });
  return (script, input) => {
    Promise.resolve()
      .then(() => script(tools, console, input === undefined ? null : JSON.parse(input))())
      // A value JSON can't hold (a function, a symbol) comes back as null, as JSON.stringify leaves it out of an object.
      .then((r) => JSON.stringify(r === undefined ? null : r) ?? "null")
      .then((r) => done(true, r), (e) => done(false, e === null ? null : e && e.message !== undefined ? String(e.message) : String(e)));
  };
})`;

const stopped = (message: string) => {
  if (/interrupted/i.test(message)) return COMPUTED;
  if (/out of memory|out of bounds memory/i.test(message)) return MEMORY;
  return message;
};

/**
 * Scripts in QuickJS. The caller's api is reached only through the functions given to the runner,
 * and is closed when the run ends or times out: a promise the script left behind settles into
 * nothing, and a call it makes after the end is refused by the api (mcp.ts).
 */
export function quickjsSandbox({ cpuChecks = CPU_CHECKS, timeoutMs = TIMEOUT_MS } = {}): Sandbox {
  return async (code, api, input, caller = "") => {
    const logs: string[] = [];
    let over = false;
    let finish!: (r: ScriptResult) => void;
    const result = new Promise<ScriptResult>((resolve) => (finish = (r) => (over || resolve(r), (over = true))));
    const timer = setTimeout(() => finish({ error: `The script ran longer than ${timeoutMs / 1000} seconds and was stopped.`, logs }), timeoutMs);
    let started = false;
    try {
      // Wait for a turn: it's checked again whenever a run ends, and the wait counts toward the time limit.
      while (!free(caller)) {
        await Promise.race([new Promise<void>((r) => waiting.push(r)), result]);
        if (over) return await result;
      }
      started = true;
      running++;
      runsOf.set(caller, (runsOf.get(caller) ?? 0) + 1);

      const qjs = await instance();
      const rt = qjs.newRuntime();
      rt.setMemoryLimit(MEMORY_LIMIT);
      rt.setMaxStackSize(STACK_LIMIT);
      let checks = 0;
      let jobs = 0;
      const spent = () => checks + jobs / JOBS_PER_CHECK > cpuChecks;
      // Spent: the run ends here. QuickJS's own interrupt is an error a script's async code can catch and keep going after.
      rt.setInterruptHandler(() => (++checks, spent() ? (finish({ error: COMPUTED, logs }), true) : over));
      const ctx: QuickJSContext = rt.newContext();
      // The built-ins the host relies on, taken before the script can redefine them.
      const parse = ctx.getProp(ctx.getProp(ctx.global, "JSON"), "parse");
      const slice = ctx.getProp(ctx.getProp(ctx.getProp(ctx.global, "String"), "prototype"), "slice");
      /** A string from the script, at most `max` characters: longer, refused (or with `cut`, its first `max`). */
      const text = (h: QuickJSHandle, max: number, what: string, cut = false): string => {
        if (ctx.typeof(h) !== "string") throw new Error(`${what} isn't a string.`);
        const len = ctx.getProp(h, "length");
        const n = ctx.getNumber(len);
        len.dispose();
        if (n <= max) return ctx.getString(h);
        if (!cut) throw new Error(`${what} is longer than ${max} characters.`);
        const from = ctx.newNumber(0);
        const to = ctx.newNumber(max);
        const part = ctx.unwrapResult(ctx.callFunction(slice, h, from, to));
        from.dispose();
        to.dispose();
        const s = ctx.getString(part);
        part.dispose();
        return s;
      };
      /** Host calls not yet settled: with none and no jobs left, nothing can ever wake the script (there are no timers). */
      let inFlight = 0;
      /** Runs the promise jobs left, a batch at a time so a run that has ended stops between batches. */
      const pump = () => {
        while (!over) {
          const r = rt.executePendingJobs(JOB_BATCH);
          if ("error" in r && r.error) {
            const e = ctx.dump(r.error) as { message?: string } | string;
            r.error.dispose();
            return finish({ error: stopped(typeof e === "object" && e?.message ? e.message : String(e)), logs });
          }
          if (r.value === 0) break;
          jobs += r.value;
          if (spent()) return finish({ error: COMPUTED, logs });
        }
        if (!over && inFlight === 0) finish({ error: "The script is waiting on something that never finishes (there are no timers), and was stopped.", logs });
      };
      /** A host promise as a promise in the interpreter: its value crosses as JSON, its error as an Error with the message. */
      const bridge = (work: () => Promise<unknown>) => {
        const d = ctx.newPromise();
        inFlight++;
        work()
          .then(
            (v) => {
              if (over) return;
              const s = ctx.newString(JSON.stringify(v === undefined ? null : v));
              const h = ctx.callFunction(parse, ctx.undefined, s);
              s.dispose();
              // A result too big for the interpreter's memory ends the run rather than leaving the script waiting.
              if ("error" in h && h.error) {
                const e = ctx.dump(h.error) as { message?: string };
                h.error.dispose();
                return finish({ error: stopped(String(e?.message ?? e)), logs });
              }
              d.resolve(h.value);
              h.value.dispose();
            },
            (e) => {
              if (over) return;
              const err = ctx.newError(e instanceof Error ? e.message : String(e));
              d.reject(err);
              err.dispose();
            },
          )
          .catch((e) => finish({ error: stopped(e instanceof Error ? e.message : String(e)), logs }))
          .finally(() => {
            inFlight--;
            if (d.alive) d.dispose();
            pump();
          });
        return d.handle;
      };
      const fns: QuickJSHandle[] = [
        ctx.newFunction("call", (n, a) => {
          const name = text(n, MAX_NAME, "A tool's name");
          const args = JSON.parse(text(a, MAX_ARGS, "A tool's arguments")) as Record<string, unknown>;
          return bridge(() => api.call(name, args));
        }),
        ctx.newFunction("search", (q, l) => {
          const query = text(q, MAX_QUERY, "A search");
          const limit = ctx.getNumber(l);
          return bridge(() => api.search(query, limit < 0 ? undefined : limit));
        }),
        ctx.newFunction("describe", (n) => {
          const name = text(n, MAX_NAME, "A tool's name");
          return bridge(() => api.describe(name));
        }),
        ctx.newFunction("log", (s) => void (logs.length < 200 && ctx.typeof(s) === "string" && logs.push(text(s, MAX_LINE, "A line", true)))),
        ctx.newFunction("done", (ok, value) => {
          try {
            // null: what QuickJS throws when it can't even allocate the error (or a script's own `throw null`).
            if (!ctx.dump(ok)) return void finish({ error: ctx.typeof(value) === "string" ? stopped(text(value, MAX_LINE, "An error", true)) : "The script ran out of memory (or threw null) and was stopped.", logs });
            finish({ result: JSON.parse(text(value, MAX_RESULT, "The script's result")), logs });
          } catch (e) {
            const m = e instanceof Error ? e.message : String(e);
            finish({ error: /longer than/.test(m) ? `${m} Return less: pick the fields you need.` : stopped(m), logs });
          }
        }),
      ];
      const runner = ctx.unwrapResult(ctx.evalCode(RUNNER));
      const start = ctx.unwrapResult(ctx.callFunction(runner, ctx.undefined, ...fns));
      // The script alone, in a scope of its own: only its three parameters, not the runner's functions.
      const script = ctx.evalCode(`(function (tools, console, input) { return (\n${functionSource(code)}\n); })`, "script.js");
      if ("error" in script && script.error) {
        const e = ctx.dump(script.error) as { message?: string };
        script.error.dispose();
        finish({ error: `The script couldn't run: ${String(e?.message ?? e).slice(0, 500)}`, logs });
      } else {
        const inputJson = ctx.newString(JSON.stringify(input === undefined ? null : input));
        ctx.unwrapResult(ctx.callFunction(start, ctx.undefined, script.value, inputJson)).dispose();
        inputJson.dispose();
        script.value.dispose();
        pump();
      }
      return await result;
    } catch (e) {
      finish({ error: stopped(e instanceof Error ? e.message : String(e)), logs });
      return await result;
    } finally {
      over = true;
      clearTimeout(timer);
      if (started) {
        running--;
        const left = (runsOf.get(caller) ?? 1) - 1;
        if (left > 0) runsOf.set(caller, left);
        else runsOf.delete(caller);
        // Every waiting run looks again; those still without a turn wait again.
        const wake = waiting;
        waiting = [];
        for (const w of wake) w();
      }
      // Nothing is disposed one by one: the instance is dropped whole, its memory with it.
    }
  };
}
