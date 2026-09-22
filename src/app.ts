import { createAgentRouter } from '@flue/runtime/routing';
import { Hono } from 'hono';
import { ExplainAgent } from './agents/explain-agent.ts';
import { RegulationAgent } from './agents/regulation-agent.ts';
import { getDocument, putDocument, renderFrontmatter } from './lib/documents.ts';

const app = new Hono<{ Bindings: Env }>();

// Chat with the agent: one POST per message.
//
//   curl -X POST http://localhost:5173/agents/regulation-agent/my-first-chat \
//     -H 'content-type: application/json' \
//     -d '{"kind":"user","body":"What does the Administrative Procedure Act require?"}'
// `hono` is pinned to the exact version @flue/runtime depends on so the
// router it returns and this app share one Hono type.
app.route('/agents/regulation-agent', createAgentRouter(RegulationAgent));

// One-shot explainer for a highlighted passage in the Resources panel. The
// client mints a fresh conversation id per highlight and sends the document
// plus selection as `initialData` with its single question.
app.route('/agents/explain', createAgentRouter(ExplainAgent));

// Read a single grounded document by key, independent of the chat agent.
// There is deliberately no list endpoint: the library will grow to many
// thousands of laws, and documents surface only when the agent opens them.
app.get('/api/documents/:key{.+}', async (c) => {
	const doc = await getDocument(c.env.DOCUMENTS_BUCKET, c.req.param('key'));

	if (!doc) return c.json({ error: 'not found' }, 404);

	return c.json(doc);
});

// Ingest a document (Markdown with frontmatter) into the library. Wrangler
// cannot set R2 custom metadata, and AI Search reads its filter fields only
// from that metadata, so scripts/seed.ts uploads through here instead.
// Guarded by the SEED_TOKEN secret: `wrangler secret put SEED_TOKEN` (or .env).
//
// A PDF body (content-type application/pdf) is converted to Markdown with
// Workers AI and gets its frontmatter from x-doc-* headers, since PDFs
// cannot carry one. The key should still end in .md.
app.put('/api/documents/:key{.+}', async (c) => {
	const env = c.env as Env & { SEED_TOKEN?: string };
	if (!seedAuthorized(c.req.header('authorization'), env.SEED_TOKEN)) {
		return c.json({ error: 'unauthorized' }, 401);
	}
	const key = c.req.param('key');
	const isPdf = c.req.header('content-type')?.startsWith('application/pdf');
	const converted = isPdf
		? await env.AI.toMarkdown({ name: key.replace(/\.md$/, '.pdf'), blob: await c.req.blob() })
		: null;
	if (converted && converted.format === 'error') return c.json({ error: converted.error }, 422);
	const raw = converted
		? renderFrontmatter({
				title: c.req.header('x-doc-title') ?? key,
				jurisdiction: c.req.header('x-doc-jurisdiction') ?? '',
				level: c.req.header('x-doc-level') ?? '',
				citation: c.req.header('x-doc-citation') ?? '',
				sourceUrl: c.req.header('x-doc-source-url') ?? '',
				authors: c.req.header('x-doc-authors') ?? '',
				issuingBody: c.req.header('x-doc-issuing-body') ?? '',
			}) + converted.data.replace(/^# [^\n]*\n## Metadata\n(?:- [^\n]*\n)+/, '')
		: await c.req.text();
	const doc = await putDocument(env.DOCUMENTS_BUCKET, key, raw);
	return c.json({ key: doc.key, title: doc.title, jurisdiction: doc.jurisdiction, bytes: raw.length });
});

// Empty the library (optionally under a prefix) before a rebuild. The AI
// Search index drops the deleted files on its next sync job.
app.delete('/api/documents', async (c) => {
	const env = c.env as Env & { SEED_TOKEN?: string };
	if (!seedAuthorized(c.req.header('authorization'), env.SEED_TOKEN)) {
		return c.json({ error: 'unauthorized' }, 401);
	}
	const prefix = c.req.query('prefix') ?? '';
	let deleted = 0;
	let cursor: string | undefined;
	do {
		const page = await env.DOCUMENTS_BUCKET.list({ prefix, cursor, limit: 1000 });
		if (page.objects.length) await env.DOCUMENTS_BUCKET.delete(page.objects.map((o) => o.key));
		deleted += page.objects.length;
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return c.json({ deleted, prefix });
});

function seedAuthorized(header: string | undefined, token: string | undefined) {
	return Boolean(token) && header === `Bearer ${token}`;
}

export default app;
