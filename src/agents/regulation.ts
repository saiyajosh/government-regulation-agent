import { defineTool, useDataWriter, useModel, useTool } from '@flue/runtime';
import { array, number, object, optional, picklist, string } from 'valibot';
import type { Library } from '../lib/documents.ts';
import { GATEWAY_MODEL } from '../lib/gateway.ts';
import { findPassages, READ_CHUNK, readWindow, WHOLE_BODY_LIMIT } from '../lib/passages.ts';

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
	useTool(tools.readLaw);
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

	// Opens the document for the reader but hands the model only what it asked
	// for: a short document whole, otherwise the passages around the quotes it
	// passed (or the opening page when it passed none). Library documents run
	// to several megabytes, so the full body never travels in a tool result;
	// read_law pages through the rest on demand.
	const openLaw = defineTool({
		name: 'open_law',
		description: [
			'Open a specific document by its key in the Resources panel so the user can read the full,',
			'sourced text. Returns its metadata and, for a short document, its whole text. For a longer',
			'document it returns only the passages around each verbatim quote in `passages` (which are',
			'also highlighted for the reader as the document opens), or the first',
			`${READ_CHUNK} characters when no passages are given; use read_law to read more of it.`,
			'Pass the search_laws excerpts you plan to rely on as `passages` so the relevant text',
			'comes back in one call.',
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
					length: doc.body.length,
					...excerptFor(doc.body, data.passages ?? []),
				},
			};
		},
	});

	const readLaw = defineTool({
		name: 'read_law',
		description: [
			'Read more of a document that open_law returned only part of. Pass `find` to get the',
			'passages around every place a word or phrase appears in it (case-insensitive), or',
			`\`offset\` to read the next ${READ_CHUNK} characters from that character position (open_law and`,
			'read_law report the document length and the end of each window). Read only what the',
			'question needs: prefer `find` with a distinctive phrase over paging from the start.',
		].join(' '),
		input: object({ key: string(), find: optional(string()), offset: optional(number()) }),
		async run({ data }) {
			const doc = await library.get(data.key);

			if (!doc) return { output: { error: `No document found for key "${data.key}".` } };

			if (data.find) return { output: { key: doc.key, ...findPassages(doc.body, data.find) } };

			return { output: { key: doc.key, ...readWindow(doc.body, data.offset) } };
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

	return { searchLaws, openLaw, readLaw, highlightPassages };
}

// What open_law carries back: the whole body when it is short, otherwise a
// window around each requested passage that occurs in it, falling back to the
// opening page so the model always has something to read.
function excerptFor(body: string, passages: string[]) {
	if (body.length <= WHOLE_BODY_LIMIT) return { complete: true, body };
	const found = passages.flatMap((passage) => findPassages(body, passage, 1).passages);

	if (found.length === 0) return { complete: false, ...readWindow(body, 0) };

	return { complete: false, passages: found };
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
	'appears in the Resources panel next to your reply, passing the search excerpts you plan to',
	'rely on as `passages`, and read what comes back rather than relying on the search excerpt or',
	'on memory. A long document comes back as windows around those passages rather than whole;',
	'when the answer may sit elsewhere in it, call read_law (`find` a distinctive phrase, or page',
	'by `offset`) and read only as much as the question needs. 3) Once you know which sentences answer the',
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
