import { describe, expect, it } from 'vitest';
import type { ExplainInput } from '../lib/explain.ts';
import { EXCERPT_WINDOW, exaSearcher, excerptAround, explainTools, OFFICIAL_DOMAINS } from './explain.ts';

const body = ['# Rule', '', ...Array.from({ length: 400 }, (_, i) => `Paragraph ${i} says something about reporting year ${2000 + i}.`)].join('\n');

const input: ExplainInput = {
	source: 'document',
	key: 'federal/fr/x.md',
	title: 'Rule',
	jurisdiction: 'Federal',
	citation: '90 FR 1',
	body,
	selection: 'reporting year 2250',
	context: 'Paragraph 250 says something about reporting year 2250.',
};

// The runtime fills these in; tools only read `data` (and `signal`).
function context<T>(data: T) {
	return { toolCallId: 'call-1', log: { info() {}, warn() {}, error() {} }, data };
}

describe('excerptAround', () => {
	it('carries a short body whole', () => {
		expect(excerptAround('short body', 'body', 'short body')).toEqual({ start: 0, end: 10, text: 'short body' });
	});

	it('windows a long body around the selection and marks the cut edges', () => {
		const at = body.indexOf(input.selection);
		const excerpt = excerptAround(body, input.selection, input.context);

		expect(excerpt.start).toBe(at - EXCERPT_WINDOW);
		expect(excerpt.end).toBe(at + EXCERPT_WINDOW);
		expect(excerpt.text.startsWith('…')).toBe(true);
		expect(excerpt.text.endsWith('…')).toBe(true);
		expect(excerpt.text).toContain(input.selection);
		expect(excerpt.text.length).toBeLessThan(body.length / 2);
	});

	it('falls back to the surrounding block, then the start, when the selection is not found verbatim', () => {
		expect(excerptAround(body, 'not in the text', input.context).text).toContain(input.context);
		expect(excerptAround(body, 'not in the text', 'nor this').start).toBe(0);
	});
});

describe('explain tools', () => {
	const tools = explainTools(input, null);

	it('read_source finds every occurrence of a phrase with its surrounding text', async () => {
		const result = await tools.readSource.run(context({ find: 'REPORTING YEAR 2399' }));

		expect(result).toEqual({
			output: { find: 'REPORTING YEAR 2399', matches: 1, passages: [expect.objectContaining({ text: expect.stringContaining('Paragraph 399') })] },
		});
	});

	it('read_source reads a bounded chunk from an offset and clamps out-of-range offsets', async () => {
		const chunk = await tools.readSource.run(context({ offset: 100 }));

		expect(chunk).toEqual({ output: { offset: 100, end: 6100, length: body.length, text: body.slice(100, 6100) } });
		expect(await tools.readSource.run(context({ offset: 10 ** 9 }))).toEqual({ output: { offset: body.length, end: body.length, length: body.length, text: '' } });
	});

	it('search_web returns what the searcher returns', async () => {
		const hit = { title: 'EPA page', url: 'https://www.epa.gov/x', publishedDate: '', excerpt: 'text' };
		const withSearch = explainTools(input, async (query) => (query === 'q' ? [hit] : []));

		expect(await withSearch.searchWeb.run(context({ query: 'q' }))).toEqual({ output: [hit] });
	});
});

describe('exaSearcher', () => {
	it('posts the query restricted to official domains and maps the results', async () => {
		const calls: { url: string; init: RequestInit }[] = [];

		const fetchImpl: typeof fetch = async (url, init) => {
			calls.push({ url: String(url), init: init ?? {} });

			return Response.json({
				results: [
					{ title: 'Enforcement', url: 'https://www.epa.gov/enforcement', publishedDate: '2024-03-01', highlights: ['a', 'b'] },
					{ title: null, url: 'https://www.ecfr.gov/x' },
				],
			});
		};

		const results = await exaSearcher('key', fetchImpl)('penalty for late report');

		expect(results).toEqual([
			{ title: 'Enforcement', url: 'https://www.epa.gov/enforcement', publishedDate: '2024-03-01', excerpt: 'a\n…\nb' },
			{ title: 'https://www.ecfr.gov/x', url: 'https://www.ecfr.gov/x', publishedDate: '', excerpt: '' },
		]);
		expect(calls[0].url).toBe('https://api.exa.ai/search');
		expect(new Headers(calls[0].init.headers).get('x-api-key')).toBe('key');
		expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ query: 'penalty for late report', includeDomains: OFFICIAL_DOMAINS, numResults: 5 });
	});

	it('throws on a non-2xx response so the model sees the failure', async () => {
		const fetchImpl: typeof fetch = async () => new Response('nope', { status: 401 });

		await expect(exaSearcher('bad', fetchImpl)('q')).rejects.toThrow(/401/);
	});
});
