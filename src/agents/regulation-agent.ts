'use agent';
import { getCloudflareContext } from '@flue/runtime/cloudflare';
import { defineTool, useDataWriter, useModel, useTool } from '@flue/runtime';
import { object, string } from 'valibot';
import { getDocument, listDocuments, searchDocuments } from '../lib/documents.ts';

function bucket() {
	return getCloudflareContext().env.DOCUMENTS_BUCKET as R2Bucket;
}

const searchLaws = defineTool({
	name: 'search_laws',
	description:
		'Search the grounded document library for federal, state, county, or municipal acts, laws, regulations, and statutes matching a query (title, jurisdiction, or citation).',
	input: object({ query: string() }),
	async run({ data }) {
		const results = await searchDocuments(bucket(), data.query);
		return {
			output: results.map(({ key, title, jurisdiction, citation }) => ({
				key,
				title,
				jurisdiction,
				citation,
			})),
		};
	},
});

const listLaws = defineTool({
	name: 'list_laws',
	description: 'List every document currently available in the grounded document library.',
	async run() {
		const results = await listDocuments(bucket());
		return {
			output: results.map(({ key, title, jurisdiction, citation }) => ({
				key,
				title,
				jurisdiction,
				citation,
			})),
		};
	},
});

type WriteOpenDocument = (data: { key: string; title: string }) => void;

function openLaw(writeOpenDocument: WriteOpenDocument) {
	return defineTool({
		name: 'open_law',
		description:
			'Open a specific document by its key in the Resources panel so the user can read the full, sourced text, and return that text so you can quote or reason about it.',
		input: object({ key: string() }),
		async run({ data }) {
			const doc = await getDocument(bucket(), data.key);
			if (!doc) return { output: { error: `No document found for key "${data.key}".` } };

			writeOpenDocument({ key: doc.key, title: doc.title });

			return {
				output: {
					key: doc.key,
					title: doc.title,
					jurisdiction: doc.jurisdiction,
					citation: doc.citation,
					sourceUrl: doc.sourceUrl,
					body: doc.body,
				},
			};
		},
	});
}

export function RegulationAgent() {
	// Keyless: runs on Workers AI through Cloudflare AI Gateway (dashboard
	// observability, caching, budget controls) with no provider API key.
	// Swap in e.g. useModel('<provider>/<model>') plus
	// a provider API key in .env for a stronger hosted model instead.
	useModel('cloudflare/@cf/mistralai/mistral-small-3.1-24b-instruct');

	const writeOpenDocument = useDataWriter('openDocument', {
		schema: object({ key: string(), title: string() }),
	});
	useTool(searchLaws);
	useTool(listLaws);
	useTool(openLaw(writeOpenDocument));

	return [
		'You are a research assistant that helps people understand United States law:',
		'federal, state, county, and municipal acts, statutes, and regulations.',
		'Always ground factual claims in the document library via search_laws / list_laws / open_law',
		'rather than relying on memory, and cite the document key and citation you used.',
		"If nothing in the library covers the question, say so plainly rather than guessing.",
	].join(' ');
}
