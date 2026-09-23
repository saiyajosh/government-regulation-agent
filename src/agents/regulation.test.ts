import { describe, expect, it } from 'vitest';
import { memoryLibrary } from '../lib/documents.ts';
import { READ_CHUNK, WHOLE_BODY_LIMIT } from '../lib/passages.ts';
import { REGULATION_INSTRUCTIONS, regulationTools } from './regulation.ts';

const DOCS = [
	{
		key: 'federal/cfr/98-2.md',
		title: 'Who must report',
		jurisdiction: 'Federal',
		citation: '40 CFR 98.2',
		sourceUrl: 'https://example.test/98.2',
		level: 'federal',
		authors: '',
		issuingBody: 'EPA',
		body: 'A facility that emits 25,000 units per year CO2e or more per year must report.\n\nOther text.',
	},
	{
		key: 'regional/baaqmd/6-1.md',
		title: 'Particulate matter',
		jurisdiction: 'Bay Area',
		citation: 'BAAQMD Reg. 6, Rule 1',
		sourceUrl: '',
		level: 'regional',
		authors: '',
		issuingBody: 'BAAQMD',
		body: 'No person shall emit particulate matter exceeding the limits of this rule.',
	},
	{
		key: 'federal/fr/long.md',
		title: 'A long rule',
		jurisdiction: 'Federal',
		citation: '89 FR 1',
		sourceUrl: '',
		level: 'federal',
		authors: '',
		issuingBody: 'EPA',
		// Well past WHOLE_BODY_LIMIT, with one distinctive sentence buried deep inside.
		body: `${'Preamble filler text. '.repeat(3000)}The applicability threshold is 25,000 units per year.${' Trailing filler text.'.repeat(3000)}`,
	},
];

// The runtime fills these in; tools only read `data`.
function context<T>(data: T) {
	return { toolCallId: 'call-1', log: { info() {}, warn() {}, error() {} }, data };
}

describe('regulation tools', () => {
	const tools = regulationTools(memoryLibrary(DOCS));

	it('search_laws returns summaries with excerpts and honours the level filter', async () => {
		const all = await tools.searchLaws.run(context({ query: 'facility emits metric tons report' }));

		expect(all).toEqual({
			output: [
				expect.objectContaining({ key: 'federal/cfr/98-2.md', citation: '40 CFR 98.2', level: 'federal', excerpts: [expect.objectContaining({ text: expect.stringContaining('25,000') })] }),
			],
		});

		const regional = await tools.searchLaws.run(context({ query: 'emit particulate matter limits', level: 'regional' as const }));

		expect(regional).toEqual({ output: [expect.objectContaining({ key: 'regional/baaqmd/6-1.md' })] });
		expect(await tools.searchLaws.run(context({ query: 'emit particulate matter limits', level: 'state' as const }))).toEqual({ output: [] });
	});

	it('read_law returns a short document whole', async () => {
		expect(await tools.readLaw.run(context({ key: 'federal/cfr/98-2.md' }))).toEqual({
			output: { key: 'federal/cfr/98-2.md', title: 'Who must report', citation: '40 CFR 98.2', length: DOCS[0].body.length, complete: true, body: DOCS[0].body },
		});
	});

	it('read_law returns the opening page of a long document, then pages by offset', async () => {
		const body = DOCS[2].body;

		expect(body.length).toBeGreaterThan(WHOLE_BODY_LIMIT);

		const first = await tools.readLaw.run(context({ key: 'federal/fr/long.md' }));

		expect(first).toEqual({
			output: expect.objectContaining({ key: 'federal/fr/long.md', title: 'A long rule', complete: false, offset: 0, end: READ_CHUNK, length: body.length, text: body.slice(0, READ_CHUNK) }),
		});
		expect(JSON.stringify(first).length).toBeLessThan(READ_CHUNK + 500);

		expect(await tools.readLaw.run(context({ key: 'federal/fr/long.md', offset: READ_CHUNK }))).toEqual({
			output: expect.objectContaining({ offset: READ_CHUNK, end: READ_CHUNK * 2, text: body.slice(READ_CHUNK, READ_CHUNK * 2) }),
		});
		expect(await tools.readLaw.run(context({ key: 'federal/fr/long.md', offset: body.length + 50 }))).toEqual({
			output: expect.objectContaining({ offset: body.length, end: body.length, text: '' }),
		});
	});

	it('read_law finds the passages around a phrase', async () => {
		expect(await tools.readLaw.run(context({ key: 'federal/fr/long.md', find: 'APPLICABILITY THRESHOLD' }))).toEqual({
			output: expect.objectContaining({ key: 'federal/fr/long.md', complete: false, find: 'APPLICABILITY THRESHOLD', matches: 1, passages: [expect.objectContaining({ text: expect.stringContaining('25,000 units per year') })] }),
		});
	});

	it('read_law reports an unknown key', async () => {
		expect(await tools.readLaw.run(context({ key: 'nope.md', find: 'x' }))).toEqual({ output: { error: 'No document found for key "nope.md".' } });
	});

	it('highlight_passages echoes the count and does nothing else', async () => {
		expect(await tools.highlightPassages.run(context({ key: 'k', passages: ['a', 'b'] }))).toEqual({ output: { key: 'k', highlighted: 2 } });
	});
});

// The prompt is what keeps the tool loop short: the runtime already runs one
// turn's calls in parallel, so the instructions must ask for batched turns.
describe('regulation instructions', () => {
	it('ask for independent tool calls to be batched into one turn', () => {
		expect(REGULATION_INSTRUCTIONS).toMatch(/issue all of those searches together in one turn/);
		expect(REGULATION_INSTRUCTIONS).toMatch(/read_law calls for different documents together in one turn/);
		expect(REGULATION_INSTRUCTIONS).toMatch(/must always go out together in one turn/);
	});

	it('leave opening documents to the client and require highlight_passages', () => {
		expect(REGULATION_INSTRUCTIONS).not.toMatch(/open_law/);
		expect(REGULATION_INSTRUCTIONS).toMatch(/open automatically in the Resources panel/);
		expect(REGULATION_INSTRUCTIONS).toMatch(/Call highlight_passages for every document your answer relies on/);
		expect(REGULATION_INSTRUCTIONS).toMatch(/one search turn, one highlight_passages turn, then the answer/);
	});
});
