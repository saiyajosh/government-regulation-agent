import { createAgentRouter } from '@flue/runtime/routing';
import { Hono } from 'hono';
import { ExplainAgent } from './agents/explain-agent.ts';
import { RegulationAgent } from './agents/regulation-agent.ts';
import { getDocument } from './lib/documents.ts';

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

export default app;
