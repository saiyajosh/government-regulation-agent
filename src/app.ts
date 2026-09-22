import { createAgentRouter } from '@flue/runtime/routing';
import { Hono } from 'hono';
import { ExplainAgent } from './agents/explain-agent.ts';
import { RegulationAgent } from './agents/regulation-agent.ts';
import {
	createConversation,
	getConversation,
	isUntouched,
	listConversations,
	updateConversation,
} from './lib/conversations.ts';
import { getDocument, putDocument, renderFrontmatter } from './lib/documents.ts';
import { mintConversationId, ownsConversation, requireUser } from './lib/identity.ts';

const app = new Hono<{ Bindings: Env; Variables: { userId: string } }>();

// Conversation and agent requests run as an anonymous cookie identity. The
// cookie is minted on first contact, so the first request a browser makes
// (the conversation list) is what establishes who it is. The document routes
// under /api/documents are bearer-token only (SEED_TOKEN) and stay outside
// this layer: scripts/seed.ts never has a user, and a Worker without
// COOKIE_SECRET must still accept uploads. In Hono a trailing `/*` also
// matches the bare path, so this one pattern covers GET/POST /api/conversations.
app.use('/api/conversations/*', async (c, next) => {
	c.set('userId', await requireUser(c));
	await next();
});

// Agent mounts carry no auth of their own (see Flue's routing guide), so the
// host app checks both halves here: who is calling, and whether the
// conversation id in the path belongs to them. Ids are server-issued as
// `<userId>.<random>`, so ownership is a prefix test and a guessed id is
// rejected without any lookup. The pattern ends in `/*` to cover prompts,
// stream reads, aborts, and attachment downloads alike.
app.use('/agents/:agent/:id/*', async (c, next) => {
	const userId = await requireUser(c);

	if (!ownsConversation(userId, c.req.param('id'))) return c.json({ error: 'forbidden' }, 403);
	c.set('userId', userId);
	await next();
});

// Chat with the agent: one POST per message.
//
//   curl -X POST http://localhost:5173/agents/regulation-agent/<userId>.<id> \
//     -H 'content-type: application/json' \
//     -d '{"kind":"user","body":"What does the Administrative Procedure Act require?"}'
//
// The first user prompt also stamps the index: it becomes the title and bumps
// updatedAt. Later prompts write nothing; recency is carried by the client's
// snippet PATCH to /api/conversations/:id once each reply settles, so the two
// index writers never overlap in time.
app.post('/agents/regulation-agent/:id', async (c, next) => {
	const message = await c.req.raw.clone().json<{ kind?: string; body?: string }>();
	await next();

	if (c.res.status !== 202 || message.kind !== 'user' || !message.body) return;
	c.executionCtx.waitUntil(stampTitle(c.env.CONVERSATIONS, c.get('userId'), c.req.param('id'), message.body));
});

// `hono` is pinned to the exact version @flue/runtime depends on so the
// router it returns and this app share one Hono type.
app.route('/agents/regulation-agent', createAgentRouter(RegulationAgent));

// One-shot explainer for a highlighted passage. The client mints a fresh
// `<userId>.<random>` id per highlight and sends the document plus selection
// as `initialData` with its single question. Not indexed: it is throwaway.
app.route('/agents/explain', createAgentRouter(ExplainAgent));

// The caller's conversations, newest activity first, plus the user id the
// client needs to mint ids for the explain agent.
app.get('/api/conversations', async (c) => {
	const userId = c.get('userId');

	return c.json({ userId, conversations: await listConversations(c.env.CONVERSATIONS, userId) });
});

app.post('/api/conversations', async (c) => {
	const userId = c.get('userId');

	return c.json(await createConversation(c.env.CONVERSATIONS, userId, mintConversationId(userId)), 201);
});

// The client reports the reply snippet for the list view. Only the owner's
// own requests reach here, so a self-reported snippet is trusted. Only the
// snippet is accepted: the title is stamped server-side from the first prompt.
app.patch('/api/conversations/:id', async (c) => {
	const userId = c.get('userId');
	const id = c.req.param('id');

	if (!ownsConversation(userId, id)) return c.json({ error: 'forbidden' }, 403);
	const patch = await c.req.json<{ snippet?: string }>();
	const record = await updateConversation(c.env.CONVERSATIONS, userId, id, { snippet: patch.snippet });

	if (!record) return c.json({ error: 'not found' }, 404);

	return c.json(record);
});

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
	if (!seedAuthorized(c.req.header('authorization'), c.env.SEED_TOKEN)) {
		return c.json({ error: 'unauthorized' }, 401);
	}

	const key = c.req.param('key');
	const isPdf = c.req.header('content-type')?.startsWith('application/pdf');

	const converted = isPdf
		? await c.env.AI.toMarkdown({ name: key.replace(/\.md$/, '.pdf'), blob: await c.req.blob() })
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

	const doc = await putDocument(c.env.DOCUMENTS_BUCKET, key, raw);

	return c.json({ key: doc.key, title: doc.title, jurisdiction: doc.jurisdiction, bytes: raw.length });
});

// Empty the library (optionally under a prefix) before a rebuild. The AI
// Search index drops the deleted files on its next sync job.
app.delete('/api/documents', async (c) => {
	if (!seedAuthorized(c.req.header('authorization'), c.env.SEED_TOKEN)) {
		return c.json({ error: 'unauthorized' }, 401);
	}

	const prefix = c.req.query('prefix') ?? '';
	let deleted = 0;
	let cursor: string | undefined;

	do {
		const page = await c.env.DOCUMENTS_BUCKET.list({ prefix, cursor, limit: 1000 });

		if (page.objects.length) await c.env.DOCUMENTS_BUCKET.delete(page.objects.map((o) => o.key));
		deleted += page.objects.length;
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);

	return c.json({ deleted, prefix });
});

function seedAuthorized(header: string | undefined, token: string | undefined) {
	return Boolean(token) && header === `Bearer ${token}`;
}

async function stampTitle(kv: KVNamespace, userId: string, id: string, body: string) {
	const current = await getConversation(kv, userId, id);

	if (!current || !isUntouched(current)) return;
	await updateConversation(kv, userId, id, { title: body });
}

export default app;
