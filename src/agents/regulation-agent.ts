'use agent';

import { getCloudflareContext } from '@flue/runtime/cloudflare';
import { defineTool, setProvider, useDataWriter, useModel, useTool } from '@flue/runtime';
import { object, string } from 'valibot';
import { getDocument, searchDocuments } from '../lib/documents.ts';
import { GATEWAY_MODEL, gatewayProvider } from '../lib/gateway.ts';

setProvider(gatewayProvider());

function bucket() {
	// SAFETY: wrangler.jsonc binds DOCUMENTS_BUCKET as an R2 bucket; Flue's
	// CloudflareContext exposes env as an untyped record.
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
	// Claude Sonnet 5 via the BYOK gateway provider (see src/lib/gateway.ts).
	useModel(GATEWAY_MODEL);

	const writeOpenDocument = useDataWriter('openDocument', {
		schema: object({ key: string(), title: string() }),
	});

	useTool(searchLaws);
	useTool(openLaw(writeOpenDocument));

	return [
		'You are a research assistant that helps people understand United States law:',
		'federal, state, county, and municipal acts, statutes, and regulations.',
		'Always ground factual claims in the document library: find candidates with search_laws, then',
		'open_law the ones that answer the question so the user can read them alongside your reply,',
		'and cite the document key and citation you used rather than relying on memory.',
		"If nothing in the library covers the question, say so plainly rather than guessing.",
	].join(' ');
}

// Pins the durable identity so the generated Durable Object class is
// `FlueRegulationAgent` (Flue always wraps the identity as `Flue<Name>Agent`,
// so the function name alone would yield `FlueRegulationAgentAgent`).
RegulationAgent.agentName = 'Regulation';
