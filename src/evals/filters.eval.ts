import { start } from '@flue/runtime/node';
import { afterAll, expect, it } from 'vitest';
import { gatewayProvider } from '../lib/gateway.ts';
import { ask, highlightedKeys, RegulationEval, searchCalls } from './harness.ts';

const flue = await start({ agents: [RegulationEval], providers: [gatewayProvider()] });

afterAll(() => flue.stop());

it('scopes a question about the Bay Area air district to the regional level or jurisdiction', async () => {
	const { reply, toolCalls } = await ask(
		RegulationEval,
		'What does the Bay Area air district require before I build new equipment that emits air contaminants?',
	);

	const searches = searchCalls(toolCalls);

	expect(searches.length).toBeGreaterThan(0);
	expect(searches.some((search) => search.level === 'regional' || search.jurisdiction === 'Bay Area')).toBe(true);
	expect(highlightedKeys(toolCalls)).toContain('regional/bay-area/baaqmd-reg-2-rule-1.md');
	expect(reply.text).toMatch(/authority to construct/i);
});

it('scopes a question about Oakland to the municipal level or jurisdiction and finds the gas ban', async () => {
	const { reply, toolCalls } = await ask(RegulationEval, 'Can I put a natural gas line in a new building in Oakland?');
	const searches = searchCalls(toolCalls);

	expect(searches.some((search) => search.level === 'municipal' || /oakland/i.test(search.jurisdiction ?? ''))).toBe(true);
	expect(reply.text).toMatch(/December 4, 2020|15\.37/);
});

// A question that names no place may still be scoped by inference (the term
// is a Clean Air Act one); what matters is that no filter hides the answer.
it('still finds the right document when the question names no place or level', async () => {
	const { reply, toolCalls } = await ask(RegulationEval, 'What is a "standard of performance" for a new stationary source?');
	const searches = searchCalls(toolCalls);

	expect(searches.length).toBeGreaterThan(0);
	expect(searches.every((search) => search.jurisdiction === undefined || search.jurisdiction === 'Federal')).toBe(true);
	expect(highlightedKeys(toolCalls)).toContain('federal/usc/42-7411.md');
	expect(reply.text).toMatch(/best system of emission reduction/i);
});
