# Contributing to Boarder

Boarder is the board between people and their AI agents. DGit builds it and runs it as a hosted service at
https://boarder.dgit.co. This repository is its source, published so you can read it, check it and suggest changes.
Pull requests are welcome. This page is what a review will ask of you, written down first.

## Before you start

- **Sign the CLA.** On your first pull request the CLA bot asks you to sign [CLA.md](CLA.md) by posting one comment.
  It lets the project owner (see the CLA) license your change together with the rest of Boarder, including in the
  hosted service. Nothing is merged without it.
- **Open an issue first for anything bigger than a small fix**, so we can say yes or no before you spend the time.
  Small fixes (a bug with a clear cause, a typo, a test) can go straight to a pull request.
- **Self-hosting is out of scope.** Changes whose main purpose is running your own copy (deployment guides,
  container images, making hosted-only settings configurable) won't be merged. Boarder is offered as a hosted
  service.
- **Security problems go to a private report, not an issue.** See [SECURITY.md](SECURITY.md).

## What we take

- Bug fixes with a way to reproduce the bug.
- Engine adapters and connectors that follow the existing contracts (`docs/engine-adapter.md`,
  `apps/web/worker/connectors`).
- Accessibility, performance and test improvements.

Changes to the look of the product, naming or wording are decided by DGit. Suggest them in an issue first.

## Checking your change

You need Node 24 and pnpm.

```sh
pnpm install
pnpm typecheck                                        # TypeScript for apps/web
pnpm build                                            # the web app and the Worker
node --test apps/web/worker/importer/group.test.ts    # unit tests (Node 24 strips the types)
node --test packages/cli/src/*.test.mjs
```

Add or change a test with every behavior change, and say in the pull request how you checked it (commands you ran,
or a screenshot for anything on screen).

## How a pull request is reviewed and merged

1. **CLA** signed (the bot's check is green).
2. **Scope**: one change per pull request, and it fits "What we take" above.
3. **Review**: a DGit maintainer reviews correctness, tests and fit. Expect questions; small style points may be
   fixed by us on merge instead of asked of you.
4. **Merge**: this repository is published from DGit's internal repository. When we accept your pull request we
   apply it there, and it comes back here with the next publish, with you as co-author
   (`Co-authored-by: you`). The pull request is then closed with a link to that commit, so it shows as closed, not
   merged. Your authorship is kept in the commit.

A pull request with no reply from its author for 30 days may be closed. You can reopen it any time.

## Issues

Use the templates: **Bug report** (what happened, what you expected, how to reproduce) or **Feature request**
(the problem first, then your idea). Questions about your own Boarder account go to support inside the product,
not here.
