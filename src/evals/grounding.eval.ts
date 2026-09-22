import { start } from '@flue/runtime/node';
import { afterAll, expect, it } from 'vitest';
import { gatewayProvider } from '../lib/gateway.ts';
import { FIXTURES } from './fixtures.ts';
import { ask, highlightCalls, openedKeys, quotes, RegulationEval } from './harness.ts';

const flue = await start({ agents: [RegulationEval], providers: [gatewayProvider()] });

afterAll(() => flue.stop());

it('grounds a factual answer: searches, opens the right document, highlights verbatim quotes, and cites it', async () => {
	const { reply, toolCalls } = await ask(
		RegulationEval,
		'Under the federal greenhouse gas reporting program, how many metric tons of CO2e per year must a facility emit before it has to report?',
	);

	const names = toolCalls.map((call) => call.name);

	expect(names).toContain('search_laws');
	expect(names).toContain('open_law');
	expect(names.indexOf('search_laws')).toBeLessThan(names.indexOf('open_law'));

	expect(openedKeys(toolCalls)).toContain('federal/cfr/40-98-2.md');

	// The reply reaches the user with the document opened alongside it.
	expect(reply.data.openDocument).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'federal/cfr/40-98-2.md' })]));

	// Every highlighted passage is a real quote from the document it names.
	const highlights = highlightCalls(toolCalls);

	expect(highlights.length).toBeGreaterThan(0);

	for (const highlight of highlights) {
		const doc = FIXTURES.find((fixture) => fixture.key === highlight.key);

		expect(doc, `highlight_passages named an unknown key ${highlight.key}`).toBeDefined();
		expect(highlight.passages.length).toBeGreaterThan(0);

		for (const passage of highlight.passages) {
			expect(quotes(doc!.body, passage), `not a verbatim quote: ${passage}`).toBe(true);
		}
	}

	expect(reply.text).toContain('25,000');
	expect(reply.text).toMatch(/98\.2/);
});

it('remembers the thread: a follow-up question is answered in context', async () => {
	const { reply } = await ask(RegulationEval, 'What is the California cap-and-trade inclusion threshold for a facility?');

	expect(reply.text).toContain('25,000');
	expect(reply.text).toMatch(/95812/);
});
