# government-regulation-agent

Explore and understand U.S. federal, state, county, and municipal laws and
regulations: a chat interface backed by a [Flue](https://flueframework.com)
agent, alongside a tabbed "Resources" view rendering the sourced Markdown/MDX
documents the agent grounds its answers in. Documents are stored in a
Cloudflare R2 bucket; the app runs on Cloudflare Workers via Vite, Hono, and
React.

## Setup

```sh
pnpm install
```

The agent runs keyless by default (Cloudflare Workers AI via AI Gateway — no
API key, and you get request logging/caching in the Cloudflare dashboard for
free). To use a hosted provider instead, add its key to `.env` and change the
`useModel(...)` call in `src/agents/regulation-agent.ts`:

```sh
# .env
ANTHROPIC_API_KEY="sk-ant-..."
```

## Develop

```sh
pnpm run dev
```

Opens the chat + Resources UI at `http://localhost:5173`. See `src/app.ts`
for the route map (`/agents/regulation-agent/:id` for chat, `/api/documents`
for the document library).

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
