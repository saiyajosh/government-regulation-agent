import { createProvider } from '@earendil-works/pi-ai';
import { cloudflareAIGatewayProvider } from '@earendil-works/pi-ai/providers/cloudflare-ai-gateway';
import { cloudflareAIGatewayAuth } from '@earendil-works/pi-ai/providers/cloudflare-auth';

// Claude through Cloudflare AI Gateway with a stored (BYOK) provider key.
// Pi's built-in gateway provider already does the BYOK dance — it reads
// CLOUDFLARE_API_KEY / CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_GATEWAY_ID, sends
// `cf-aig-authorization`, and strips the provider `x-api-key` header so the
// gateway injects the stored key. Our key is stored under a non-default alias,
// which the gateway only honors on direct provider requests when named via
// `cf-aig-byok-alias`, so re-register the provider with that header added.
//
// Every agent module calls `setProvider(gatewayProvider())` at its top level
// rather than app.ts doing it once, so `flue run` (which loads only the agent
// module) picks it up too. Env: CLOUDFLARE_API_KEY (an AI Gateway token),
// CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_GATEWAY_ID, CLOUDFLARE_AI_GATEWAY_BYOK_ALIAS.
export const GATEWAY_MODEL = 'cloudflare-ai-gateway/claude-sonnet-5';

export function gatewayProvider() {
	const gatewayAuth = cloudflareAIGatewayAuth();
	return createProvider({
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
	});
}
