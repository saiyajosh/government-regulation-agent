import { start } from '@flue/runtime/node';
import { afterAll, expect, it } from 'vitest';
import { gatewayProvider } from '../lib/gateway.ts';
import { FIXTURES } from './fixtures.ts';
import { ask, highlightedKeys, RegulationEval } from './harness.ts';

const flue = await start({ agents: [RegulationEval], providers: [gatewayProvider()] });

afterAll(() => flue.stop());

// San Jose is inside the library's advertised scope but absent from the
// fixture corpus, so the agent has to search, come up empty, and say so
// rather than answer from memory or pass off another city's rule.
it('says plainly when the library does not cover the question instead of answering from memory', async () => {
	const { reply, toolCalls } = await ask(
		RegulationEval,
		'What does the San Jose reach code require for natural gas in new residential construction?',
	);

	expect(toolCalls.map((call) => call.name)).toContain('search_laws');
	// The gap is stated about San Jose specifically, and nothing was highlighted
	// that does not exist in the library.
	expect(reply.text).toMatch(/San Jose[^.]{0,160}\b(no|not|nothing|none)\b|\b(no|not|nothing|none)\b[^.]{0,160}San Jose/i);
	expect(highlightedKeys(toolCalls).every((key) => FIXTURES.some((doc) => doc.key === key))).toBe(true);
});

it('answers a question far outside the library without inventing a source', async () => {
	const { reply, toolCalls } = await ask(
		RegulationEval,
		'What is the current price of an allowance in the European Union Emissions Trading System?',
	);

	expect(toolCalls.map((call) => call.name)).not.toContain('read_law');
	expect(toolCalls.map((call) => call.name)).not.toContain('highlight_passages');
	expect(reply.text).toMatch(/library|not (find|cover|contain|include|have|locate)|no (document|relevant|information)|doesn't|does not|don't|do not|unable|outside/i);
	expect(reply.text).not.toMatch(/€\s?\d|EUR\s?\d/);
});
