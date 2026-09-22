'use agent';

import { getCloudflareContext } from '@flue/runtime/cloudflare';
import { setProvider, useInitialData } from '@flue/runtime';
import { exaSearcher, explainAgent } from './explain.ts';
import { explainInput, type ExplainInput } from '../lib/explain.ts';
import { gatewayProvider } from '../lib/gateway.ts';

setProvider(gatewayProvider());

// A single-question, single-answer explainer for a highlighted passage. Each
// highlight creates a fresh conversation (the client mints a new id), the user
// asks one question, and the conversation is never contacted again. Wiring
// only: the tools and instructions live in explain.ts. Web search runs
// through Exa when EXA_API_KEY is set (`wrangler secret put EXA_API_KEY`;
// .env locally) and is simply absent otherwise.
export function ExplainAgent() {
	// SAFETY: EXA_API_KEY is an optional Worker secret; Flue's CloudflareContext
	// exposes env as an untyped record.
	const env = getCloudflareContext().env as { EXA_API_KEY?: string };

	return explainAgent(useInitialData<ExplainInput | undefined>(), env.EXA_API_KEY ? exaSearcher(env.EXA_API_KEY) : null);
}

ExplainAgent.agentName = 'Explain';

ExplainAgent.initialData = explainInput;
