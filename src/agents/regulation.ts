import { defineTool, useModel, useTool } from '@flue/runtime';
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

	const tools = regulationTools(library);

	useTool(tools.searchLaws);
	useTool(tools.readLaw);
	useTool(tools.highlightPassages);

	return REGULATION_INSTRUCTIONS;
}

// The tools never open anything for the reader: the client opens the top
// search matches in the Resources panel itself, and lets the user open the
// rest, so the model only searches, reads, and marks passages.
export function regulationTools(library: Library) {
	const searchLaws = defineTool({
		name: 'search_laws',
		description: [
			'Semantic search over the grounded library of greenhouse gas and climate regulation at three',
			'scopes: Federal (Clean Air Act, EPA rules, GHG Reporting Program, Federal Register), California',
			'(AB 32, Health and Safety Code, CARB regulations), and the Bay Area (Air District rules and',
			'Oakland, San Jose, and San Francisco codes). Phrase the query as a natural-language question or',
			'description of the legal issue (not just keywords). Returns the most relevant documents',
			'with their best-matching verbatim passages, citations, and keys for read_law and',
			'highlight_passages. The top matches open automatically in the Resources panel. Optionally restrict',
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

	// Hands the model only what it asked for: a short document whole, otherwise
	// the passages around a phrase or one page from an offset. Library documents
	// run to several megabytes, so the full body never travels in a tool result.
	const readLaw = defineTool({
		name: 'read_law',
		description: [
			'Read a document by its key from search_laws. A short document comes back whole. For a',
			'longer one, pass `find` to get the passages around every place a word or phrase appears',
			`(case-insensitive), or \`offset\` to read the next ${READ_CHUNK} characters from that`,
			'character position (each result reports the document length and the end of its window);',
			`with neither it returns the first ${READ_CHUNK} characters. Read only what the question`,
			'needs: prefer `find` with a distinctive phrase over paging from the start.',
		].join(' '),
		input: object({ key: string(), find: optional(string()), offset: optional(number()) }),
		async run({ data }) {
			const doc = await library.get(data.key);

			if (!doc) return { output: { error: `No document found for key "${data.key}".` } };

			const meta = { key: doc.key, title: doc.title, citation: doc.citation, length: doc.body.length };

			if (data.find) return { output: { ...meta, complete: false, ...findPassages(doc.body, data.find) } };

			if (data.offset === undefined && doc.body.length <= WHOLE_BODY_LIMIT) return { output: { ...meta, complete: true, body: doc.body } };

			return { output: { ...meta, complete: false, ...readWindow(doc.body, data.offset) } };
		},
	});

	// Marks the sentences the reply actually leans on. The tool does no work of
	// its own: the client reads its input off the message and highlights those
	// strings in the rendered document.
	const highlightPassages = defineTool({
		name: 'highlight_passages',
		description: [
			'Mark the passages of a document that directly support your answer, so the reader sees',
			'them highlighted in the Resources panel. Each passage must be a verbatim quote copied',
			'from the document text (a search_laws excerpt or a sentence from read_law): a sentence or',
			'a few consecutive sentences, never a paraphrase or a summary. Call it once per document',
			'your answer relies on, before writing your reply. When several documents support the',
			'answer, make all of those calls together in one turn, never one call per turn.',
		].join(' '),
		input: object({ key: string(), passages: array(string()) }),
		async run({ data }) {
			return { output: { key: data.key, highlighted: data.passages.length } };
		},
	});

	return { searchLaws, readLaw, highlightPassages };
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
	'1) Call search_laws (rephrase or narrow the query if the first pass misses). When a question',
	'spans several scopes or issues, issue all of those searches together in one turn. The top',
	'matches of every search open automatically in the Resources panel, and the reader can open',
	'any other result from the list under the search. 2) The excerpts search_laws returns are',
	'verbatim passages of the documents. When they already contain the sentences that answer the',
	'question, rely on them directly. When the answer may sit elsewhere in a document, call',
	'read_law (`find` a distinctive phrase, or page by `offset`) and read only as much as the',
	'question needs, issuing the read_law calls for different documents together in one turn.',
	'3) Call highlight_passages for every document your answer relies on, with the exact verbatim',
	'sentences it rests on, one call per document, all in the same turn. This is how the reader',
	'sees which sentences matter, so never skip it. 4) Write the answer from what those documents',
	'say, and name each document (title and citation) it draws on.',
	'Tool calls that do not depend on each other must always go out together in one turn; every',
	'extra round trip makes the reader wait, so the usual shape is one search turn, one',
	'highlight_passages turn, then the answer, with a read_law turn between them only when the',
	'excerpts do not settle the question. Do this',
	'even when you already know the answer, and even for simple definitional questions, because',
	'the point of this tool is to connect people to the primary source. Never skip search_laws',
	'or highlight_passages to save space: a short answer must still be a sourced answer. If nothing in the',
	'library covers the question, say so plainly rather than guessing.',
	'Your audience is the general public, not lawyers or policy specialists, so by default write',
	'in a friendly, professional tone and keep answers concise and in plain English. Brevity applies',
	'to how you write, never to how much research you do. Lead with the direct answer to what was',
	'asked, then only as much context as is needed to understand it. Avoid legal and technical',
	'jargon; when a term of art such as "cap-and-trade" or "MMTCO2e" is unavoidable, explain it in',
	'a few plain words the first time it appears. Skip preamble, caveats that do not change the',
	'answer, and exhaustive lists of every related provision; mention that more detail exists and',
	'offer to go deeper instead. Cite sources in a light-touch way, for example "(California',
	'Health and Safety Code § 38562, open in Resources)". Quoting briefly in the reply is fine,',
	'but always pass the full supporting sentences to highlight_passages so the reader can find',
	'them in the source. Short paragraphs are preferred over long, dense responses. The chat',
	'renders plain text, so do not use markdown syntax such as **bold**, headings, or bullet',
	'markers; use plain sentences and line breaks instead.',
	'These are defaults, not limits. If the user asks for a different tone, more or less detail,',
	'full technical or legal specifics, longer quotations, or a particular format, follow that',
	'request for the rest of the conversation until they ask for something else. The requirement',
	'to search and open sources is not adjustable.',
].join(' ');
