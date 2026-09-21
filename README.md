# government-regulation-agent

Explore and understand U.S. federal, state, county, and municipal laws and
regulations: a chat interface backed by a [Flue](https://flueframework.com)
agent. When the agent opens a law it cites, a tabbed "Resources" panel slides
in beside the chat and renders the sourced Markdown/MDX document; otherwise the
chat fills the window. Documents are stored in a
Cloudflare R2 bucket; the app runs on Cloudflare Workers via Vite, Hono, and
React.

## Setup

```sh
pnpm install
```

The agent runs Claude Sonnet 5 through Cloudflare AI Gateway using a stored
(BYOK) provider key, so the model provider's key lives in the gateway, not in this
repo. One-time gateway setup: turn on Authenticated Gateway, store the
Claude API key under Provider Keys with the alias below, and create a Cloudflare
API token with the "AI Gateway: Run" permission. Then fill in `.env`:

```sh
# .env
CLOUDFLARE_API_KEY="<AI Gateway token>"
CLOUDFLARE_ACCOUNT_ID="<account id>"
CLOUDFLARE_GATEWAY_ID="<gateway slug>"
CLOUDFLARE_AI_GATEWAY_BYOK_ALIAS="greenhouse-guide-model-key"
```

For the deployed Worker, the non-secret values are `vars` in `wrangler.jsonc`
and the token is a secret: `wrangler secret put CLOUDFLARE_API_KEY`.

## Develop

```sh
pnpm run dev
```

Opens the chat UI at `http://localhost:5173`. See `src/app.ts` for the route
map (`/agents/regulation-agent/:id` for chat, `/api/documents/:key` to read
one document). There is no list endpoint on purpose: the library will hold
too many laws to enumerate, so documents surface only when the agent opens
them.

## Seed the document library

Documents are Markdown files with a small frontmatter block, stored in R2
under `documents/<jurisdiction>/<slug>.md`:

```sh
npx wrangler r2 object put government-regulation-agent/documents/federal/my-law.md \
  --file ./my-law.md --content-type text/markdown --remote
```

```md
---
title: My Law
jurisdiction: Federal
citation: 12 U.S.C. § 34
sourceUrl: https://www.govinfo.gov/...
---

# My Law

...
```

Drop `--remote` to seed the local dev bucket instead.

## Deploy

```sh
pnpm run deploy
```

## Learn more

- [Flue docs](https://flueframework.com/docs/) — or `npx flue docs` from the terminal.
