import { defineTool, useModel, useTool } from '@flue/runtime';
import { number, object, optional, string } from 'valibot';
import type { ExplainInput } from '../lib/explain.ts';
import { GATEWAY_MODEL } from '../lib/gateway.ts';
import { findPassages, READ_CHUNK, readWindow, WHOLE_BODY_LIMIT } from '../lib/passages.ts';

// The Explain agent's tools and instructions, parameterized on the web
// searcher so they run against Exa in the Worker and against a fixture
// searcher in tests and evals. This module carries no `'use agent'`
// directive: the agent identity lives in explain-agent.ts.

// A type alias, not an interface: tool outputs must be JSON-compatible, and
// the runtime's output type only accepts structural object types.
export type WebResult = {
	title: string;
	url: string;
	publishedDate: string;
	// Query-relevant passages from the page, joined; empty when Exa found none.
	excerpt: string;
};

export type WebSearcher = (query: string, signal?: AbortSignal) => Promise<WebResult[]>;

// Only official sources: the app's promise is that every answer traces back
// to a government document, and a web hop must not quietly break that.
export const OFFICIAL_DOMAINS = [
	'epa.gov',
	'ecfr.gov',
	'federalregister.gov',
	'govinfo.gov',
	'regulations.gov',
	'congress.gov',
	'energy.gov',
	'ca.gov',
	'baaqmd.gov',
	'oaklandca.gov',
	'sanjoseca.gov',
	'sf.gov',
	'sfgov.org',
	'library.municode.com',
];

// How much of the source document travels in the prompt. The whole body is
// held in `initialData` and re-sent on every model call of the tool loop,
// so a Federal Register rule (200KB) would cost its full length per turn;
// the prompt carries a window around the selection instead and the rest is
// a read_source call away.
export const EXCERPT_WINDOW = 3000;

export function explainAgent(input: ExplainInput | undefined, searchWeb: WebSearcher | null) {
	useModel(GATEWAY_MODEL);

	if (!input) return 'No document was supplied. Tell the reader to highlight a passage and ask again.';
	const tools = explainTools(input, searchWeb);
	const excerpt = excerptAround(input.body, input.selection, input.context);

	useTool(tools.readSource);

	if (searchWeb) useTool(tools.searchWeb);

	return [
		'You answer exactly one question about a passage the reader highlighted.',
		'The passage comes either from a legal document in the library or from a reply the research assistant gave earlier in this session; the <document> tag says which.',
		'Answer from the document first. The prompt carries only the part of the document around the highlight; when the answer may sit elsewhere in it, call read_source to read more before deciding the document does not answer. When several terms or regions are worth reading, issue all of those read_source calls together in one turn rather than one at a time.',
		searchWeb
			? 'If the document itself does not settle the question, call search_web, which searches only official government sites, and answer from what it returns. Say plainly which part of your answer comes from the document and which from the web, and name each web source by its title. Do not search when the document already answers.'
			: 'Do not use outside knowledge and do not speculate about other laws.',
		'Write for the general public: friendly, plain English, no legal or technical jargon without a few words of explanation, no preamble, no restating the question, no closing offers.',
		'When the answer comes from the document alone, keep it to two to four sentences. When web sources contribute, you may use up to two short paragraphs: the answer, then one sentence per source saying what it adds.',
		'When the document defines or qualifies the term, quote the exact clause and say where in the document it appears (section heading or number).',
		'If neither the document nor the web answers the question, say so in one sentence and stop.',
		'Reply in plain prose. No headings, no bullet lists, no markdown formatting, no raw URLs (the reader sees the sources as links).',
		'',
		`<document source="${input.source}" key="${input.key}" title="${input.title}" jurisdiction="${input.jurisdiction}" citation="${input.citation}" length="${input.body.length}" excerpt="${excerpt.start}-${excerpt.end}">`,
		excerpt.text,
		'</document>',
		'',
		'<highlighted>',
		input.selection,
		'</highlighted>',
		'',
		'<surrounding_passage>',
		input.context,
		'</surrounding_passage>',
	].join('\n');
}

export function explainTools(input: ExplainInput, searchWeb: WebSearcher | null) {
	const readSource = defineTool({
		name: 'read_source',
		description: [
			'Read more of the source document than the prompt shows. Pass `find` to get the passages',
			'around every place a word or phrase appears (case-insensitive), or `offset` to read the',
			`next ${READ_CHUNK} characters from that position. The document is ${input.body.length} characters long.`,
		].join(' '),
		input: object({ find: optional(string()), offset: optional(number()) }),
		async run({ data }) {
			if (data.find) return { output: findPassages(input.body, data.find) };

			return { output: readWindow(input.body, data.offset) };
		},
	});

	const searchWebTool = defineTool({
		name: 'search_web',
		description: [
			'Search official government websites (EPA, eCFR, Federal Register, California agencies,',
			'Bay Area air district and city sites) for facts the source document does not settle.',
			'Phrase the query as a natural-language question. Returns the most relevant pages with',
			'query-relevant passages. Use at most twice per question.',
		].join(' '),
		input: object({ query: string() }),
		async run({ data, signal }) {
			// Only mounted when a searcher exists (see explainAgent), so this throw
			// is a programming error, not a model-visible outcome.
			if (!searchWeb) throw new Error('Web search is not configured.');

			return { output: await searchWeb(data.query, signal) };
		},
	});

	return { readSource, searchWeb: searchWebTool };
}

// The window of the body the prompt carries: the whole thing when it is
// short, otherwise EXCERPT_WINDOW characters either side of the highlight
// (located by the selection, then by its surrounding block, then the start).
export function excerptAround(body: string, selection: string, context: string) {
	if (body.length <= WHOLE_BODY_LIMIT) return { start: 0, end: body.length, text: body };
	const at = [selection, context].map((needle) => body.indexOf(needle)).find((index) => index !== -1) ?? 0;
	const start = Math.max(0, at - EXCERPT_WINDOW);
	const end = Math.min(body.length, at + EXCERPT_WINDOW);

	return {
		start,
		end,
		text: `${start > 0 ? '…' : ''}${body.slice(start, end)}${end < body.length ? '…' : ''}`,
	};
}

// Exa search restricted to official domains, with query-relevant highlights
// instead of full page text so tool results stay small.
export function exaSearcher(apiKey: string, fetchImpl: typeof fetch = fetch): WebSearcher {
	return async (query, signal) => {
		const response = await fetchImpl('https://api.exa.ai/search', {
			method: 'POST',
			signal,
			headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
			body: JSON.stringify({
				query,
				type: 'auto',
				numResults: 5,
				includeDomains: OFFICIAL_DOMAINS,
				contents: { highlights: { maxCharacters: 1500 } },
			}),
		});

		if (!response.ok) throw new Error(`Exa search failed: ${response.status} ${await response.text()}`);

		// SAFETY: this is Exa's documented response shape; every field read
		// below is optional-chained so a missing one degrades to empty text.
		const data = (await response.json()) as {
			results?: { title?: string | null; url: string; publishedDate?: string | null; highlights?: string[] }[];
		};

		return (data.results ?? []).map((result) => ({
			title: result.title ?? result.url,
			url: result.url,
			publishedDate: result.publishedDate ?? '',
			excerpt: (result.highlights ?? []).join('\n…\n'),
		}));
	};
}
