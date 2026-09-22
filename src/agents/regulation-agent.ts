'use agent';

import { getCloudflareContext } from '@flue/runtime/cloudflare';
import { setProvider } from '@flue/runtime';
import { cloudflareLibrary } from '../lib/documents.ts';
import { gatewayProvider } from '../lib/gateway.ts';
import { regulationAgent } from './regulation.ts';

setProvider(gatewayProvider());

// Wiring only: the tools and instructions live in regulation.ts, parameterized
// on the library, so they can run without Cloudflare bindings in tests.
export function RegulationAgent() {
	// SAFETY: wrangler.jsonc binds AI_SEARCH to the AI Search instance that
	// indexes DOCUMENTS_BUCKET and DOCUMENTS_BUCKET to that R2 bucket; Flue's
	// CloudflareContext exposes env as an untyped record.
	const env = getCloudflareContext().env as { AI_SEARCH: AiSearchInstance; DOCUMENTS_BUCKET: R2Bucket };

	return regulationAgent(cloudflareLibrary(env.AI_SEARCH, env.DOCUMENTS_BUCKET));
}

// Pins the durable identity so the generated Durable Object class is
// `FlueRegulationAgent` (Flue always wraps the identity as `Flue<Name>Agent`,
// so the function name alone would yield `FlueRegulationAgentAgent`).
RegulationAgent.agentName = 'Regulation';
