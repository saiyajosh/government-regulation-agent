import { start } from '@flue/runtime/node';
import { afterAll, expect, it } from 'vitest';
import type { ExplainInput } from '../lib/explain.ts';
import { gatewayProvider } from '../lib/gateway.ts';
import { FIXTURES } from './fixtures.ts';
import { ask, ExplainEval } from './harness.ts';

const flue = await start({ agents: [ExplainEval], providers: [gatewayProvider()] });

afterAll(() => flue.stop());

const doc = FIXTURES[0];

const input: ExplainInput = {
	source: 'document',
	key: doc.key,
	title: doc.title,
	jurisdiction: doc.jurisdiction,
	citation: doc.citation,
	body: doc.body,
	selection: '25,000 metric tons CO2e or more per year',
	context: 'A facility that contains any source category listed in Table A-4 of this subpart and that emits 25,000 metric tons CO2e or more per year in combined emissions from all stationary fuel combustion units and listed source categories must report.',
};

it('answers a question about the highlighted passage from the document text alone, in plain prose', async () => {
	const { reply, toolCalls } = await ask(ExplainEval, 'Does this threshold count all of a facility’s emissions or only some of them?', {
		initialData: input,
	});

	expect(toolCalls.map((call) => call.name)).not.toContain('search_web');
	expect(reply.text).toMatch(/combined|stationary fuel combustion|listed source categor/i);
	expect(reply.text).not.toMatch(/^\s*[#*-]/m);
	expect(reply.text.split(/(?<=[.!?])\s+/).length).toBeLessThanOrEqual(6);
});

it('falls back to official web sources when the document does not answer, and says so', async () => {
	const { reply, toolCalls } = await ask(ExplainEval, 'What is the penalty for failing to report?', { initialData: input });

	expect(toolCalls.map((call) => call.name)).toContain('search_web');
	expect(reply.text).toMatch(/51,796/);
	expect(reply.text).toMatch(/Enforcement|EPA/);
	expect(reply.text).not.toMatch(/https?:\/\//);
});

// The "no document was supplied" branch of the prompt is unreachable through
// dispatch: the initialData schema is required, so the runtime rejects a
// creating send without data before the agent renders.
it('rejects a conversation created without the document as malformed', async () => {
	await expect(ask(ExplainEval, 'What does this mean?')).rejects.toThrow(/malformed/i);
});
