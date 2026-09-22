import { describe, expect, it } from 'vitest';
import { memoryLibrary } from '../lib/documents.ts';
import { regulationTools } from './regulation.ts';

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
		body: 'A facility that emits 25,000 metric tons CO2e or more per year must report.\n\nOther text.',
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
];

// The runtime fills these in; tools only read `data`.
function context<T>(data: T) {
	return { toolCallId: 'call-1', log: { info() {}, warn() {}, error() {} }, data };
}

describe('regulation tools', () => {
	const opened: { key: string; title: string }[] = [];
	const tools = regulationTools(memoryLibrary(DOCS), (doc) => opened.push(doc));

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

	it('open_law returns the full document and tells the client to open it', async () => {
		const result = await tools.openLaw.run(context({ key: 'federal/cfr/98-2.md' }));

		expect(result).toEqual({
			output: expect.objectContaining({ key: 'federal/cfr/98-2.md', title: 'Who must report', body: DOCS[0].body, sourceUrl: 'https://example.test/98.2' }),
		});
		expect(opened).toEqual([{ key: 'federal/cfr/98-2.md', title: 'Who must report' }]);
	});

	it('open_law reports an unknown key without opening anything', async () => {
		const before = opened.length;

		expect(await tools.openLaw.run(context({ key: 'nope.md' }))).toEqual({ output: { error: 'No document found for key "nope.md".' } });
		expect(opened).toHaveLength(before);
	});

	it('highlight_passages echoes the count and does nothing else', async () => {
		expect(await tools.highlightPassages.run(context({ key: 'k', passages: ['a', 'b'] }))).toEqual({ output: { key: 'k', highlighted: 2 } });
	});
});
