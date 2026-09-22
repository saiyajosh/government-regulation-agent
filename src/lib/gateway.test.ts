import { describe, expect, it } from 'vitest';
import { GATEWAY_MODEL, gatewayProvider } from './gateway.ts';

function authContext(vars: Record<string, string | undefined>) {
	return {
		env: async (name: string) => vars[name],
		fileExists: async () => false,
	};
}

describe('gatewayProvider', () => {
	const provider = gatewayProvider();

	it('exposes only Anthropic models, including the one the agents use', () => {
		const models = provider.getModels();

		expect(models.length).toBeGreaterThan(0);
		expect(models.every((model) => model.api === 'anthropic-messages')).toBe(true);
		expect(models.some((model) => `${provider.id}/${model.id}` === GATEWAY_MODEL)).toBe(true);
	});

	it('adds the BYOK alias header on top of the gateway auth', async () => {
		const resolved = await provider.auth.apiKey?.resolve({
			ctx: authContext({
				CLOUDFLARE_API_KEY: 'gw-token',
				CLOUDFLARE_ACCOUNT_ID: 'acct',
				CLOUDFLARE_GATEWAY_ID: 'gw',
				CLOUDFLARE_AI_GATEWAY_BYOK_ALIAS: 'my-alias',
			}),
			credential: undefined,
		});

		expect(resolved?.auth.headers).toMatchObject({
			'cf-aig-authorization': 'Bearer gw-token',
			'cf-aig-byok-alias': 'my-alias',
			'x-api-key': null,
		});
	});

	it('leaves the auth untouched when no alias is configured, and resolves nothing without a key', async () => {
		const noAlias = await provider.auth.apiKey?.resolve({
			ctx: authContext({ CLOUDFLARE_API_KEY: 'gw-token', CLOUDFLARE_ACCOUNT_ID: 'acct', CLOUDFLARE_GATEWAY_ID: 'gw' }),
			credential: undefined,
		});

		expect(noAlias?.auth.headers).not.toHaveProperty('cf-aig-byok-alias');
		expect(await provider.auth.apiKey?.resolve({ ctx: authContext({}), credential: undefined })).toBeUndefined();
	});
});
