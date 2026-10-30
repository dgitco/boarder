# Boarder

The board between people and their AI agents: every agent window on your machines, what each is doing, and the
decisions waiting for you, in one place. Boarder is a hosted service by DGit at **https://boarder.dgit.co**.

This repository is Boarder's source, published so you can read it, check what runs on your machines and suggest
changes.

## What's here

| Path | What |
| --- | --- |
| `apps/web` | The web app (React, Vite, Tailwind) and its API, one Cloudflare Worker (Hono) with D1, R2 and Durable Objects |
| `packages/cli` | The `boarder` CLI: connects a machine, runs the engine daemon, imports sessions |
| `docs/engine-adapter.md` | The six-verb contract an engine (tmux or your own) implements |

## License

Source-available under the **Functional Source License 1.1, Apache 2.0 future license** (FSL-1.1-ALv2,
[LICENSE.md](LICENSE.md)). You may read, use, modify and share it for anything except a Competing Use: offering it,
or something substantially similar, to others as a commercial product or service. Each version becomes Apache 2.0
two years after it is published. This is not an OSI open-source license.

"Boarder" and its logo are trademarks of Boarder's owner and are not licensed ([TRADEMARKS.md](TRADEMARKS.md)).

Running your own copy is not supported; Boarder is offered as a hosted service.

## Contributing

Pull requests are welcome after signing the [CLA](CLA.md). See [CONTRIBUTING.md](CONTRIBUTING.md). Security
reports: [SECURITY.md](SECURITY.md).
