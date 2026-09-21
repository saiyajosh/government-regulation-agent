'use agent';
import { createProvider } from '@earendil-works/pi-ai';
import { cloudflareAIGatewayProvider } from '@earendil-works/pi-ai/providers/cloudflare-ai-gateway';
import { cloudflareAIGatewayAuth } from '@earendil-works/pi-ai/providers/cloudflare-auth';
import { getCloudflareContext } from '@flue/runtime/cloudflare';
import { defineTool, setProvider, useDataWriter, useModel, useTool } from '@flue/runtime';
import { object, string } from 'valibot';
import { getDocument, listDocuments, searchDocuments } from '../lib/documents.ts';

// Claude through Cloudflare AI Gateway with a stored (BYOK) provider key.
// Pi's built-in gateway provider already does the BYOK dance — it reads
// CLOUDFLARE_API_KEY / CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_GATEWAY_ID, sends
// `cf-aig-authorization`, and strips the provider `x-api-key` header so the
// gateway injects the stored key. Our key is stored under a non-default alias,
// which the gateway only honors on direct provider requests when named via
// `cf-aig-byok-alias`, so re-register the provider with that header added.
// Registered here rather than in app.ts so `flue run` (which loads only the
// agent module) picks it up too.
const gatewayAuth = cloudflareAIGatewayAuth();
setProvider(
	createProvider({
		id: 'cloudflare-ai-gateway',
		name: 'Cloudflare AI Gateway (BYOK)',
		auth: {
			apiKey: {
				...gatewayAuth,
				async resolve(input) {
					const resolved = await gatewayAuth.resolve(input);
					const alias = await input.ctx.env('CLOUDFLARE_AI_GATEWAY_BYOK_ALIAS');
					if (!resolved || !alias) return resolved;
					return {
						...resolved,
						auth: {
							...resolved.auth,
							headers: { ...resolved.auth.headers, 'cf-aig-byok-alias': alias },
						},
					};
				},
			},
		},
		models: cloudflareAIGatewayProvider()
			.getModels()
			.filter((model) => model.id.startsWith('claude-')),
		api: cloudflareAIGatewayProvider(),
	}),
);

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
	// Claude Sonnet 5 via the BYOK gateway provider registered above; the
	// provider key never leaves Cloudflare. Env: CLOUDFLARE_API_KEY (an AI
	// Gateway token), CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_GATEWAY_ID,
	// CLOUDFLARE_AI_GATEWAY_BYOK_ALIAS.
	useModel('cloudflare-ai-gateway/claude-sonnet-5');

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
