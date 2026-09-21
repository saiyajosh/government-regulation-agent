'use agent';
import { createProvider } from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { cloudflareAIGatewayProvider } from '@earendil-works/pi-ai/providers/cloudflare-ai-gateway';
import { cloudflareAIGatewayAuth } from '@earendil-works/pi-ai/providers/cloudflare-auth';
import { cloudflareStreams } from '@earendil-works/pi-ai/providers/cloudflare-stream';
import { getCloudflareContext } from '@flue/runtime/cloudflare';
import { defineTool, setProvider, useDataWriter, useModel, useTool } from '@flue/runtime';
import { object, optional, picklist, string } from 'valibot';
import { getDocument, searchDocuments } from '../lib/documents.ts';

// Anthropic through Cloudflare AI Gateway with a stored (BYOK) provider key.
// Pi's built-in gateway provider already does the BYOK dance — it reads
// CLOUDFLARE_API_KEY / CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_GATEWAY_ID, sends
// `cf-aig-authorization`, and strips the Anthropic `x-api-key` header so the
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
			.filter((model) => model.api === 'anthropic-messages'),
		api: cloudflareStreams(anthropicMessagesApi()),
	}),
);

function bucket() {
	return getCloudflareContext().env.DOCUMENTS_BUCKET as R2Bucket;
}

function search() {
	return getCloudflareContext().env.AI_SEARCH as AiSearchInstance;
}

const searchLaws = defineTool({
	name: 'search_laws',
	description: [
		'Semantic search over the grounded library of federal, state, county, and municipal acts,',
		'laws, regulations, and statutes. Phrase the query as a natural-language question or',
		'description of the legal issue (not just keywords). Returns the most relevant documents',
		'with their best-matching passages, citations, and keys for open_law. Optionally restrict',
		'to a level of government, or to a jurisdiction exactly as it is named in the library',
		'(for example "Federal", "California", "Miami-Dade County, Florida", "Oakland, California").',
	].join(' '),
	input: object({
		query: string(),
		level: optional(picklist(['federal', 'state', 'county', 'municipal'])),
		jurisdiction: optional(string()),
	}),
	async run({ data }) {
		const results = await searchDocuments(search(), bucket(), data.query, {
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
					level: doc.level,
					authors: doc.authors,
					issuingBody: doc.issuingBody,
					body: doc.body,
				},
			};
		},
	});
}

export function RegulationAgent() {
	// Claude Sonnet 5 via the BYOK gateway provider registered above; the
	// Anthropic key never leaves Cloudflare. Env: CLOUDFLARE_API_KEY (an AI
	// Gateway token), CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_GATEWAY_ID,
	// CLOUDFLARE_AI_GATEWAY_BYOK_ALIAS.
	useModel('cloudflare-ai-gateway/claude-sonnet-5');

	const writeOpenDocument = useDataWriter('openDocument', {
		schema: object({ key: string(), title: string() }),
	});
	useTool(searchLaws);
	useTool(openLaw(writeOpenDocument));

	return [
		'You are a research assistant that helps people understand United States law:',
		'federal, state, county, and municipal acts, statutes, and regulations.',
		'Always ground factual claims in the document library: search_laws runs a semantic search and',
		'returns the most relevant passages with their source documents. Rephrase or narrow the query',
		'if the first pass misses. Then open_law the documents whose passages actually answer the',
		'question so the user can read them alongside your reply, quote the relevant text, and cite',
		'the document key and citation you used rather than relying on memory.',
		"If nothing in the library covers the question, say so plainly rather than guessing.",
	].join(' ');
}

// Pins the durable identity so the generated Durable Object class is
// `FlueRegulationAgent` (Flue always wraps the identity as `Flue<Name>Agent`,
// so the function name alone would yield `FlueRegulationAgentAgent`).
RegulationAgent.agentName = 'Regulation';
