import { defineTool, useDataWriter, useModel, useTool } from '@flue/runtime';
import { array, object, optional, picklist, string } from 'valibot';
import type { Library } from '../lib/documents.ts';
import { GATEWAY_MODEL } from '../lib/gateway.ts';

// The Regulation agent's tools and instructions, parameterized on the document
// library so they run against AI Search + R2 in the Worker and against an
// in-memory fixture library in tests and evals. This module carries no
// `'use agent'` directive: the agent identity lives in regulation-agent.ts.

// The agent body. regulation-agent.ts calls it with the AI Search + R2
// library; evals call it from their own agent function with a fixture library.
export function regulationAgent(library: Library) {
	// Claude Sonnet 5 via the BYOK gateway provider (see src/lib/gateway.ts).
	useModel(GATEWAY_MODEL);

	const writeOpenDocument = useDataWriter('openDocument', {
		schema: object({ key: string(), title: string() }),
	});

	const tools = regulationTools(library, writeOpenDocument);

	useTool(tools.searchLaws);
	useTool(tools.openLaw);
	useTool(tools.highlightPassages);

	return REGULATION_INSTRUCTIONS;
}

export type WriteOpenDocument = (data: { key: string; title: string }) => void;

export function regulationTools(library: Library, writeOpenDocument: WriteOpenDocument) {
	const searchLaws = defineTool({
		name: 'search_laws',
		description: [
			'Semantic search over the grounded library of greenhouse gas and climate regulation at three',
			'scopes: Federal (Clean Air Act, EPA rules, GHG Reporting Program, Federal Register), California',
			'(AB 32, Health and Safety Code, CARB regulations), and the Bay Area (Air District rules and',
			'Oakland, San Jose, and San Francisco codes). Phrase the query as a natural-language question or',
			'description of the legal issue (not just keywords). Returns the most relevant documents',
			'with their best-matching passages, citations, and keys for open_law. Optionally restrict',
			'to a level of government (regional means an air district such as the Bay Area AQMD), or to a',
			'jurisdiction exactly as it is named in the library (for example "Federal", "California",',
			'"Bay Area", "Oakland, California", "San Jose, California").',
		].join(' '),
		input: object({
			query: string(),
			level: optional(picklist(['federal', 'state', 'regional', 'county', 'municipal'])),
			jurisdiction: optional(string()),
		}),
		async run({ data }) {
			const results = await library.search(data.query, {
				jurisdiction: data.jurisdiction,
				level: data.level,
			});

			return {
				output: results.map((match) => ({
					key: match.key,
					title: match.title,
					jurisdiction: match.jurisdiction,
					citation: match.citation,
					level: match.level,
					authors: match.authors,
					issuingBody: match.issuingBody,
					excerpts: match.excerpts,
				})),
			};
		},
	});

	const openLaw = defineTool({
		name: 'open_law',
		description: [
			'Open a specific document by its key in the Resources panel so the user can read the full,',
			'sourced text, and return that text so you can quote or reason about it. If you already know',
			'which passages matter (for example from search_laws excerpts), pass them as verbatim quotes',
			'in `passages` and they are highlighted for the reader as the document opens.',
		].join(' '),
		input: object({ key: string(), passages: optional(array(string())) }),
		async run({ data }) {
			const doc = await library.get(data.key);

			if (!doc) return { output: { error: `No document found for key "${data.key}".` } };

			writeOpenDocument({ key: doc.key, title: doc.title });

			return {
				output: {
					key: doc.key,
					title: doc.title,
					jurisdiction: doc.jurisdiction,
					citation: doc.citation,
					sourceUrl: doc.sourceUrl,
					level: doc.level,
					authors: doc.authors,
					issuingBody: doc.issuingBody,
					body: doc.body,
				},
			};
		},
	});

	// Marks the sentences the reply actually leans on. The tool does no work of
	// its own: the client reads its input off the message and highlights those
	// strings in the rendered document.
	const highlightPassages = defineTool({
		name: 'highlight_passages',
		description: [
			'Mark the passages of an open document that directly support your answer, so the reader',
			'sees them highlighted in the Resources panel. Each passage must be a verbatim quote copied',
			'from the document text: a sentence or a few consecutive sentences, never a paraphrase or a',
			'summary. Call this after open_law and before writing your reply.',
		].join(' '),
		input: object({ key: string(), passages: array(string()) }),
		async run({ data }) {
			return { output: { key: data.key, highlighted: data.passages.length } };
		},
	});

	return { searchLaws, openLaw, highlightPassages };
}

export const REGULATION_INSTRUCTIONS = [
	'You are a research assistant that helps people understand greenhouse gas and climate',
	'regulation in the United States. The document library covers three scopes: Federal (the',
	'Clean Air Act and related statutes, EPA stationary and mobile source rules, the GHG Reporting',
	'Program, fuel and appliance efficiency standards, and Federal Register final and proposed',
	'rules since 2020); California (AB 32 and successor statutes, the CARB and vehicle parts of the',
	'Health and Safety Code, the renewables portfolio standard, and CARB regulations such as',
	'mandatory reporting, cap-and-trade, the Low Carbon Fuel Standard, and Advanced Clean Cars);',
	'and the Bay Area (Bay Area Air Quality Management District rules, and Oakland, San Jose, and',
	'San Francisco code provisions on climate, building electrification, and vehicles).',
	'When a question names a level of government or a place, pass the matching level or',
	'jurisdiction to search_laws; otherwise search without filters and let relevance decide.',
	'Every answer must be grounded in official government sources from the document library, and',
	'you must show the user those sources. Follow this process on every substantive question:',
	'1) Call search_laws (rephrase or narrow the query if the first pass misses). 2) Call open_law',
	'on every document whose passages your answer actually relies on, so the full official text',
	'appears in the Resources panel next to your reply, and read what comes back rather than',
	'relying on the search excerpt or on memory. 3) Once you know which sentences answer the',
	'question, call highlight_passages with those exact verbatim quotes (or pass them as',
	'`passages` to open_law) so they are marked in the open document. 4) Write the answer from',
	'what those documents say, and name each document (title and citation) it draws on. Do this',
	'even when you already know the answer, and even for simple definitional questions, because',
	'the point of this tool is to connect people to the primary source. Never skip search_laws',
	'or open_law to save space: a short answer must still be a sourced answer. If nothing in the',
	'library covers the question, say so plainly rather than guessing.',
	'Your audience is the general public, not lawyers or policy specialists, so by default write',
	'in a friendly, professional tone and keep answers concise and in plain English. Brevity applies',
	'to how you write, never to how much research you do. Lead with the direct answer to what was',
	'asked, then only as much context as is needed to understand it. Avoid legal and technical',
	'jargon; when a term of art such as "cap-and-trade" or "MMTCO2e" is unavoidable, explain it in',
	'a few plain words the first time it appears. Skip preamble, caveats that do not change the',
	'answer, and exhaustive lists of every related provision; mention that more detail exists and',
	'offer to go deeper instead. Cite sources in a light-touch way, for example "(California',
	'Health and Safety Code § 38562, opened in Resources)". Quoting briefly in the reply is fine,',
	'but always pass the full supporting sentences to highlight_passages so the reader can find',
	'them in the source. Short paragraphs are preferred over long, dense responses. The chat',
	'renders plain text, so do not use markdown syntax such as **bold**, headings, or bullet',
	'markers; use plain sentences and line breaks instead.',
	'These are defaults, not limits. If the user asks for a different tone, more or less detail,',
	'full technical or legal specifics, longer quotations, or a particular format, follow that',
	'request for the rest of the conversation until they ask for something else. The requirement',
	'to search and open sources is not adjustable.',
].join(' ');
