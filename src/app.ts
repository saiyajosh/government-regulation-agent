import { createAgentRouter } from '@flue/runtime/routing';
import { Hono } from 'hono';
import { RegulationAgent } from './agents/regulation-agent.ts';
import { getDocument, listDocuments } from './lib/documents.ts';

const app = new Hono();

// Chat with the agent: one POST per message.
//
//   curl -X POST http://localhost:5173/agents/regulation-agent/my-first-chat \
//     -H 'content-type: application/json' \
//     -d '{"kind":"user","body":"What does the Administrative Procedure Act require?"}'
// `createAgentRouter` returns a Hono instance from @flue/runtime's own
// dependency copy, which type-checks as structurally distinct from this
// project's `hono` package — cast away the mismatch.
app.route('/agents/regulation-agent', createAgentRouter(RegulationAgent) as unknown as Hono);

// REST surface for the Resources panel: list and read grounded documents
// directly, independent of the chat agent.
app.get('/api/documents', async (c) => {
	const bucket = (c.env as Env).DOCUMENTS_BUCKET;
	const documents = await listDocuments(bucket);
	return c.json(documents.map(({ key, title, jurisdiction, citation, sourceUrl }) => ({
		key,
		title,
		jurisdiction,
		citation,
		sourceUrl,
	})));
});

app.get('/api/documents/:key{.+}', async (c) => {
	const bucket = (c.env as Env).DOCUMENTS_BUCKET;
	const doc = await getDocument(bucket, c.req.param('key'));
	if (!doc) return c.json({ error: 'not found' }, 404);
	return c.json(doc);
});

export default app;
