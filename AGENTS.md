# AGENTS.md

An application to help users explore and gain a deep understanding of federal,
state, county, and municipal acts, laws, regulations, and statutes within the
United States, via a chat agent grounded in a sourced document library.

This is a [Flue](https://flueframework.com) project (agents are TypeScript
functions) targeting the Cloudflare Workers runtime, built with Vite, Hono,
and React.

## Layout

- `src/agents/` — agent modules. A module whose first line is the `'use agent'` directive exports agents: every exported capitalized function is one, and the function name is its durable identity.
- `src/app.ts` — the route map; every route (agent, REST API) is mounted here explicitly.
- `src/lib/documents.ts` — R2-backed document library: list/get/search Markdown documents with frontmatter metadata.
- `src/client/` — the chat + tabbed "Resources" (MDX document viewer) React frontend, built as static assets.
- `src/cloudflare.ts` — Worker-level exports and non-HTTP handlers.
- `wrangler.jsonc` — Worker config: R2 bucket binding, Workers AI binding, static assets, and Durable Object migrations (one per agent).

## Commands

- `npx flue run src/agents/regulation-agent.ts --message "Hi"` — run the agent locally, no server.
- `npm run dev` — start the dev server (serves the frontend and the API on the same origin).
- `npm run deploy` — build and deploy the Worker.
- `npm run check:types` — typecheck.
- `npx flue docs search <query>` — search the Flue docs from the terminal (then `flue docs read <path>`).
- `npx flue add` — list blueprints for adding channels, sandboxes, and databases.
