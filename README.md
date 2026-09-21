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

## Search index (Cloudflare AI Search)

Semantic search runs through a Cloudflare AI Search instance that indexes the
R2 bucket directly: it chunks and embeds every Markdown file, re-syncs the
bucket every 6 hours, and serves hybrid (vector + keyword) retrieval with
reranking. The agent's `search_laws` tool queries it via the `AI_SEARCH`
binding in `wrangler.jsonc`; `open_law` still reads the full document from R2.

One-time setup (R2-backed instances need a service token so AI Search can
read the bucket; the dashboard registers it for you the first time):

1. Visit `https://dash.cloudflare.com/<account id>/ai/ai-search/tokens` and
   create the AI Search service token.
2. Create the instance:

   ```sh
   npx wrangler ai-search create government-regulation-agent \
     --type r2 --source government-regulation-agent \
     --hybrid-search --reranking --max-num-results 12 \
     --custom-metadata jurisdiction:text --custom-metadata citation:text \
     --custom-metadata authors:text --custom-metadata issuing_body:text \
     --custom-metadata level:text
   ```

   The five `--custom-metadata` fields (the maximum) are read from
   `x-amz-meta-*` headers on each R2 object, not from frontmatter, and become
   filterable at query time.

3. Check progress and try a query:

   ```sh
   npx wrangler ai-search stats government-regulation-agent
   npx wrangler ai-search search government-regulation-agent --query "notice and comment rulemaking"
   ```

After bulk uploads, trigger a sync instead of waiting for the schedule:
`npx wrangler ai-search jobs create government-regulation-agent`.

## Seed the document library

Documents are Markdown files (4 MB max per file for indexing) with a small
frontmatter block, stored in R2 under `<level>/<jurisdiction>/<slug>.md`.
Upload through the ingest route so the frontmatter fields land in R2 custom
metadata, which is what the agent's filters run against.

```sh
curl -X PUT http://localhost:5173/api/documents/federal/usc/my-law.md \
  -H "authorization: Bearer $SEED_TOKEN" -H "content-type: text/markdown" \
  --data-binary @my-law.md
```

The route mirrors the frontmatter fields into the object's custom metadata
(`jurisdiction`, `level`, `citation`, `authors`, `issuing_body`).

```md
---
title: My Law
jurisdiction: Federal
level: federal
citation: 12 U.S.C. § 34
sourceUrl: https://www.govinfo.gov/...
authors: Rep. Jane Doe, Sen. John Roe
issuingBody: House Committee on Financial Services
---

# My Law

...
```

Drop `--remote` to seed the local dev bucket instead (search still hits the
deployed AI Search instance, which only sees the remote bucket).

Split large codes at the section or part level: one statute section or one
CFR part per file keeps every file under the 4 MB limit and gives the agent a
citable unit to open.

### Seeding script

`scripts/seed.ts` fetches section-level documents from the sources below,
writes them to `seed/documents/`, and with `--upload` pushes them to R2 with
the metadata headers set. It needs Node 24 (native TypeScript) and nothing
else.

Uploads go through the app's `PUT /api/documents/:key` route rather than
Wrangler, because Wrangler cannot set the R2 custom metadata AI Search filters
on. Set `SEED_TOKEN` in `.env` (and as a Worker secret for production), start
`pnpm dev`, then:

```sh
node scripts/seed.ts --limit 30 --upload     # all sources, 30 docs each
node scripts/seed.ts --only ecfr,ca          # a subset, no upload
SEED_URL=https://<worker>.workers.dev node scripts/seed.ts --upload   # against prod
npx wrangler ai-search jobs create government-regulation-agent
```

Local dev binds the real bucket (`remote: true` in `wrangler.jsonc`) because
the AI Search index only covers the remote bucket.

Sources it uses, and why:

| Level | Source | Access | Notes |
| --- | --- | --- | --- |
| Federal regulations | eCFR versioner API | Public JSON/XML, no key | Section-level XML with citation and agency; the best-structured source here. |
| Federal statutes | GovInfo U.S. Code HTML | Public, no key | One HTML page per section; the USLM XML from uscode.house.gov is the bulk path if you want whole titles. |
| Federal rules | Federal Register API | Public JSON, no key | Final rules with agency, effective date, CFR references, and GPO plain text. |
| State statutes | California leginfo | Public HTML, no key | Per-section pages; section numbers enumerated from the article listing. Other states need their own adapter. |
| County and municipal codes | Municode JSON API | Public, undocumented | Same API library.municode.com uses; covers thousands of counties and cities. Walks the TOC to section documents. |

Sources evaluated and not used:

- **NCSL (National Conference of State Legislatures)**: a research
  organization, not a statute repository. Its site is behind a WAF and its
  bill databases are summaries or paywalled. Useful as a directory of state
  legislature sites, not as a text source.
- **Open States**: bills and legislators, not enacted codes, and needs an API
  key.
- **American Legal Publishing, General Code (ecode360), Justia, Cornell LII**:
  bot protection blocks scripted access. Municode covers the same tier of
  municipal codes without that problem.
- **uscode.house.gov USLM XML**: fine for bulk, but a whole title is a
  multi-megabyte zip that needs XML parsing; per-section HTML was faster to
  wire up for a demo.

## Deploy

```sh
pnpm run deploy
```

## Learn more

- [Flue docs](https://flueframework.com/docs/) — or `npx flue docs` from the terminal.
