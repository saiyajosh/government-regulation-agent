# government-regulation-agent

Explore and understand greenhouse gas regulation at the federal, California,
and Bay Area levels (the library is seeded from official sources; see below):
a chat interface backed by a [Flue](https://flueframework.com) agent. When the agent opens a law it cites, a tabbed "Resources" panel slides
in beside the chat and renders the sourced Markdown/MDX document; otherwise the
chat fills the window. Documents are stored in a
Cloudflare R2 bucket; the app runs on Cloudflare Workers via Vite, Hono, and
React.

## Setup

```sh
pnpm install
```

The agent runs Claude Sonnet 5 through Cloudflare AI Gateway using a stored
(BYOK) Anthropic key, so the Anthropic key lives in the gateway, not in this
repo. One-time gateway setup: turn on Authenticated Gateway, store the
Anthropic key under Provider Keys with the alias below, and create a Cloudflare
API token with the "AI Gateway: Run" permission. Then fill in `.env`:

```sh
# .env
CLOUDFLARE_API_KEY="<AI Gateway token>"
CLOUDFLARE_ACCOUNT_ID="<account id>"
CLOUDFLARE_GATEWAY_ID="<gateway slug>"
CLOUDFLARE_AI_GATEWAY_BYOK_ALIAS="anthropic-takehome-project-key"
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

`scripts/seed.ts` fetches section-level documents from official sources and
uploads them through the app's ingest route (Wrangler cannot set the R2
custom metadata that AI Search filters on). It needs Node 24 and `unzip`.
Set `SEED_TOKEN` in `.env` (and as a Worker secret for production), start
`pnpm dev`, then:

```sh
# The greenhouse-gas corpus: federal, California, Bay Area. Fast sources first,
# then the CCR crawl (Cornell LII asks for a 10 s delay between requests, so
# ~2 hours) as a second process.
node scripts/seed.ts --profile ghg --only ecfr,uscode,federalRegister,ca,baaqmd,municodeSearch --limit 0 --upload --skip-existing
node scripts/seed.ts --profile ghg --only ccr --limit 0 --upload --skip-existing
npx wrangler ai-search jobs create government-regulation-agent

# General sampling and whole-title modes (see the script header).
node scripts/seed.ts --limit 30 --upload
node scripts/seed.ts --full --cfr-titles 1,5 --usc-titles 5 --ca-codes GOV --upload --skip-existing
SEED_URL=https://<worker>.workers.dev node scripts/seed.ts --profile ghg --upload   # against prod
```

`--skip-existing` makes re-runs resumable. Local dev binds the real bucket
(`remote: true` in `wrangler.jsonc`) because the AI Search index only covers
the remote bucket.

To rebuild from scratch, empty the bucket first, then trigger a sync so the
index drops the old files:

```sh
curl -X DELETE http://localhost:5173/api/documents -H "authorization: Bearer $SEED_TOKEN"
npx wrangler ai-search jobs create government-regulation-agent
```

### The greenhouse-gas profile

| Scope | Source | What is taken | Approx. docs |
| --- | --- | --- | --- |
| Federal | eCFR API | 40 CFR 52, 60, 63, 70–78, 80, 86, 87, 97, 98, 600, 1036–1090 (EPA); 10 CFR 429–431 (DOE efficiency); 49 CFR 531–538 (CAFE); 30 CFR 3179 | 8,500 |
| Federal | uscode.house.gov USLM XML | Clean Air Act (42 U.S.C. 7401–7671q), EPCA (6291–6317), CAFE (49 U.S.C. 32901–32919), IRC clean energy credits | 300 |
| Federal | Federal Register API | Final rules since 2020 and proposed rules since 2024 matching greenhouse gas, carbon dioxide, methane, fuel economy, energy conservation standards | 1,500 |
| California | leginfo | HSC div. 25.5 (AB 32 and successors), HSC div. 26 parts 1, 2, 5 (CARB, vehicles), PUC RPS article, plus SB 100, SB 375, CEQA GHG sections | 900 |
| California | Cornell LII (CCR mirror) | 17 CCR div. 3 ch. 1 subch. 10 (reporting, LCFS, cap-and-trade, methane, refrigerants) and 13 CCR div. 3 ch. 1 (vehicle rules) | 800 |
| Bay Area | baaqmd.gov (PDF) | Regulation 13 climate pollutants, Regulation 12 rules 15 and 16, Regulation 2 rule 2 | 10 |
| Bay Area | Municode search | Oakland and San Jose code sections matching climate, gas, EV, efficiency, emissions terms | 200 |

PDF sources are converted to Markdown by the ingest route with Workers AI.

### Manual documents (San Francisco)

San Francisco's codes are hosted by American Legal Publishing, which blocks
scripted access, so its climate provisions are added by hand. From
`codelibrary.amlegal.com/codes/san_francisco/latest/sf_environment`, save each
relevant chapter as PDF with the browser's print dialog, then upload it with
frontmatter supplied as headers:

```sh
curl -X PUT "http://localhost:5173/api/documents/municipal/san-francisco-ca/env-code-ch9.md" \
  -H "authorization: Bearer $SEED_TOKEN" -H "content-type: application/pdf" \
  -H "x-doc-title: SF Environment Code Chapter 9 - Greenhouse Gas Emissions Targets" \
  -H "x-doc-jurisdiction: San Francisco, California" -H "x-doc-level: municipal" \
  -H "x-doc-citation: S.F. Envt. Code ch. 9" \
  -H "x-doc-source-url: https://codelibrary.amlegal.com/codes/san_francisco/latest/sf_environment/0-0-0-38955" \
  -H "x-doc-issuing-body: San Francisco Board of Supervisors" \
  --data-binary @env-code-ch9.pdf
```

Chapters worth adding: Environment Code chapters 7 (green building), 9 (GHG
targets), 20 (existing buildings energy performance), and 30 (all-electric
new construction); Building Code chapter 13C (green building). Markdown works
the same way with `content-type: text/markdown` and frontmatter in the body.
After uploading, run `npx wrangler ai-search jobs create government-regulation-agent`.

## Deploy

```sh
pnpm run deploy
```

## Learn more

- [Flue docs](https://flueframework.com/docs/) — or `npx flue docs` from the terminal.
