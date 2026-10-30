# Boarder engine adapter

An **engine** is whatever opens AI agent windows on a machine: tmux, Herdr, an app, your own runner. An **adapter** wraps an engine in six verbs. Once an engine answers these six, Boarder can open its windows, put text in them, read their state, park them, reopen them and close them. The rules for *when* to do that (wake a quiet window, park one waiting on a person, close a finished one) live on the Boarder server, so an engine needs no rules of its own.

The official tmux adapter (`packages/cli/src/engine/tmux.mjs`) is the first implementation of this spec. `packages/cli/examples/custom-engine.mjs` is a working custom engine in both forms below; copy it and replace the verb bodies.

## How it runs

```
Boarder server ──(outbound WebSocket, device token)── boarder engine run (daemon) ── adapter ── engine
```

- `boarder engine setup` finds or installs tmux (official static build, no admin rights), finds Claude Code, self-tests, and installs the daemon as a service (systemd `--user` with `Restart=always` on Linux, launchd `KeepAlive` on macOS).
- The daemon opens one WebSocket to `/api/device/engine` with the device token. No inbound port or tunnel. It reconnects by itself.
- Every 15 seconds the daemon reads each window's state and sends only what changed (everything once a minute).

## The six verbs

| Verb | In | Out |
|---|---|---|
| `open` | `{ id, name, cwd, prompt, model, perm, system, session_id }` | `{ id, session_id }` |
| `send` | `{ id, text, test? }` | `{ ok }`, or **busy** if a person is typing in that window or a question is open. `test: true` marks a Boarder test message — put it only in a window you keep for tests, refuse it anywhere else |
| `state` | `{ id }` | `{ id, state, since?, dialog?, limit?, session_id? }` — `state` is `busy`, `idle`, `waiting`, `background`, `starting` or `none` |
| `park` | `{ id }` | `{ handle }` — everything needed to reopen the same conversation, then the window is gone |
| `reopen` | `{ handle, text, id }` | `{ id, session_id }` — the same conversation, with `text` as the next message |
| `close` | `{ id }` | `{ ok }` |

Optional: `list` → `{ windows: [{ id, name?, state?, meta? }] }` (used after the daemon restarts, and every 15 seconds). `name` and a small `meta` object (a few short fields such as the pane or folder) are sent to Boarder with the window's state, so windows Boarder did not open can still be listed.

Field notes:

- `id` is Boarder's window id (`ew_…`). Start the agent with the environment variable `BOARDER_WINDOW=<id>`, so its `boarder log` lines and cards are tied to that window.
- `perm` is `bypass` only after the person allowed "work without asking" once in Boarder (with a risk notice). Otherwise run the agent in its normal, asking mode.
- `system` is extra system prompt text (used for the main bot).
- In a self-test, `open` gets `argv` (a small echo program) and `test: true`: run `argv` instead of the AI tool.

## Status hook

If your engine knows when a window's state changes, report it right away:

```
boarder engine event <window id> <busy|idle|waiting|background|none>
```

Otherwise the daemon asks `state` every 15 seconds.

## Two ways to attach a custom engine

**Script.** One executable. Boarder runs `<file> <verb>`, writes the input as JSON on stdin and reads JSON from stdout. Exit codes: `0` done, `1` failed, `2` busy, `4` no such window.

```
boarder engine add my-engine --exec ~/bin/my-engine
```

**HTTP.** Boarder sends `POST <url>/<verb>` with a JSON body and the header `x-boarder-signature: t=<unix seconds>,v1=<hex HMAC-SHA256>` signed with this device's key. Check it with `boarder engine verify "<signature>"` (body on stdin, exit 0 = valid, signatures older than 5 minutes fail). Status codes: `200`, `409` busy, `404` no such window, anything else failed. Use a local address; `--allow-remote` is required for anything else.

```
boarder engine add my-engine --url http://127.0.0.1:7788
```

Both forms run the self-test right away: open → send → state → park → reopen → close. Only the verbs that pass go into the engine's `caps`.

## Missing verbs

Boarder works around what an engine can't do:

- no `send`: it closes the window and reopens it from the handle with the text as the first message;
- no `park`: it leaves the window open instead of parking it.

## Picking an engine

1. The engine set on the role, if any.
2. This machine's default (`boarder engine default <engine>`).
3. tmux, if installed.
4. Herdr, if its server is running.
5. A registered custom engine.
6. Nothing: Boarder still works for reports and questions (`boarder log`, `boarder ask`), but it cannot open windows on this machine.

## Herdr

Herdr (official adapter, `packages/cli/src/engine/herdr.mjs`, tested with Herdr 0.9.5): used when a Herdr server is running on the machine. One Boarder window is one Herdr workspace labelled with the window id. Closing the last pane of a Herdr workspace deletes the workspace, so parking closes the workspace and reopening creates a new one with the same conversation.

## What adapters never do

They don't read Claude credential files or the keychain, and they don't pick or switch accounts. The agent runs as the person who is signed in on that machine.
