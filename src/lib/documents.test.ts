import { describe, expect, it } from 'vitest';
import { fakeBucket, fakeSearch } from '../test/fakes.ts';
import { getDocument, memoryLibrary, putDocument, renderFrontmatter, searchDocuments } from './documents.ts';

const FRONTMATTER = renderFrontmatter({
	title: 'Clean Air Act § 111: Standards of performance',
	jurisdiction: 'Federal',
	level: 'federal',
	citation: '42 U.S.C. § 7411',
	sourceUrl: 'https://example.test/7411',
	authors: '',
	issuingBody: 'Congress',
});

describe('getDocument', () => {
	it('returns null for a missing key', async () => {
		expect(await getDocument(fakeBucket(), 'nope.md')).toBeNull();
	});

	it('parses JSON-quoted frontmatter and separates the body', async () => {
		const bucket = fakeBucket({ 'federal/usc/7411.md': `${FRONTMATTER}# Section 111\n\nBody text.` });
		const doc = await getDocument(bucket, 'federal/usc/7411.md');

		expect(doc).toMatchObject({
			key: 'federal/usc/7411.md',
			title: 'Clean Air Act § 111: Standards of performance',
			jurisdiction: 'Federal',
			level: 'federal',
			citation: '42 U.S.C. § 7411',
			issuingBody: 'Congress',
			body: '# Section 111\n\nBody text.',
		});
	});

	it('falls back to defaults and the raw body when there is no frontmatter', async () => {
		const doc = await getDocument(fakeBucket({ 'a.md': 'Just text' }), 'a.md');

		expect(doc).toMatchObject({ title: 'a.md', jurisdiction: 'Unknown', citation: '', body: 'Just text' });
	});

	it('keeps a hand-authored value that is not well-formed JSON instead of throwing', async () => {
		const raw = '---\ntitle: "The "Act" of 1990"\ncitation: \'single quoted\'\nunknown: ignored\n---\nbody';
		const doc = await getDocument(fakeBucket({ 'a.md': raw }), 'a.md');

		expect(doc?.title).toBe('The "Act" of 1990');
		expect(doc?.citation).toBe('single quoted');
	});
});

describe('putDocument', () => {
	it('stores the raw text and mirrors ASCII-normalized frontmatter into custom metadata', async () => {
		const bucket = fakeBucket();

		const raw = renderFrontmatter({
			title: 'T',
			jurisdiction: 'California',
			level: 'state',
			citation: 'Cal. Health & Safety Code § 38500 — Part 1',
			sourceUrl: '',
			authors: 'Núñez',
			issuingBody: 'Legislature',
		});

		const doc = await putDocument(bucket, 'state/ca/38500.md', raw);

		expect(doc.title).toBe('T');
		expect(bucket.objects.get('state/ca/38500.md')).toBe(raw);
		expect(bucket.metadata.get('state/ca/38500.md')).toEqual({
			jurisdiction: 'California',
			level: 'state',
			citation: 'Cal. Health & Safety Code Sec. 38500 - Part 1',
			authors: 'Nez',
			issuing_body: 'Legislature',
		});
	});
});

describe('searchDocuments', () => {
	const bucket = fakeBucket({
		'a.md': `${FRONTMATTER}A body`,
		'b.md': '---\ntitle: "B"\n---\nB body',
	});

	it('returns nothing for a blank query without calling search', async () => {
		const search = fakeSearch([{ key: 'a.md', text: 'x', score: 1 }]);

		expect(await searchDocuments(search, bucket, '   ')).toEqual([]);
		expect(search.requests).toHaveLength(0);
	});

	it('groups chunks by document, strips frontmatter, drops unknown keys, and keeps rank order', async () => {
		const search = fakeSearch([
			{ key: 'b.md', text: 'best b', score: 0.9 },
			{ key: 'a.md', text: `${FRONTMATTER}`, score: 0.8 },
			{ key: 'a.md', text: 'low a', score: 0.3 },
			{ key: 'missing.md', text: 'gone', score: 0.7 },
			{ key: 'a.md', text: 'high a', score: 0.6 },
		]);

		const matches = await searchDocuments(search, bucket, 'anything');

		expect(matches.map((match) => match.key)).toEqual(['b.md', 'a.md']);
		expect(matches[0]).toMatchObject({ title: 'B', jurisdiction: 'Unknown' });
		expect(matches[1].excerpts).toEqual([
			{ text: 'high a', score: 0.6 },
			{ text: 'low a', score: 0.3 },
		]);
	});

	it('passes only the filters that were given and applies the retrieval defaults', async () => {
		const search = fakeSearch([]);
		await searchDocuments(search, bucket, 'q', { level: 'state' });
		await searchDocuments(search, bucket, 'q', { maxResults: 3 });

		expect(search.requests[0].ai_search_options?.retrieval).toEqual({
			retrieval_type: 'hybrid',
			keyword_match_mode: 'or',
			max_num_results: 12,
			filters: { level: 'state' },
		});
		expect(search.requests[1].ai_search_options?.retrieval).toEqual({
			retrieval_type: 'hybrid',
			keyword_match_mode: 'or',
			max_num_results: 3,
		});
		expect(search.requests[0].ai_search_options?.cache).toEqual({ enabled: false });
	});
});

describe('memoryLibrary', () => {
	const library = memoryLibrary([
		{
			key: 'federal/a.md',
			title: 'Reporting',
			jurisdiction: 'Federal',
			citation: '40 CFR 98',
			sourceUrl: '',
			level: 'federal',
			authors: '',
			issuingBody: 'EPA',
			body: 'Intro.\n\nFacilities emitting 25,000 metric tons must report annually.\n\nUnrelated paragraph.',
		},
		{
			key: 'state/b.md',
			title: 'Cap and trade',
			jurisdiction: 'California',
			citation: '17 CCR 95801',
			sourceUrl: '',
			level: 'state',
			authors: '',
			issuingBody: 'CARB',
			body: 'Covered entities must surrender allowances. Reporting is annual.',
		},
	]);

	it('ranks the document whose paragraph matches most query terms first and excerpts that paragraph', async () => {
		const matches = await library.search('Which facilities must report emissions of 25,000 metric tons?');

		expect(matches[0].key).toBe('federal/a.md');
		expect(matches[0].excerpts[0].text).toBe('Facilities emitting 25,000 metric tons must report annually.');
		expect(matches[0]).not.toHaveProperty('body');
	});

	it('honours jurisdiction and level filters', async () => {
		expect((await library.search('report', { jurisdiction: 'California' })).map((m) => m.key)).toEqual(['state/b.md']);
		expect((await library.search('report', { level: 'federal' })).map((m) => m.key)).toEqual(['federal/a.md']);
	});

	it('returns nothing for a query made only of stopwords, and get resolves by key', async () => {
		expect(await library.search('what are the laws')).toEqual([]);
		expect((await library.get('state/b.md'))?.title).toBe('Cap and trade');
		expect(await library.get('nope')).toBeNull();
	});
});
