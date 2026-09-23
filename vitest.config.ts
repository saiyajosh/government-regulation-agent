import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts on purpose: that config loads the Cloudflare
// and Flue build plugins, which unit tests neither need nor can run under.
export default defineConfig({
	resolve: {
		alias: {
			'@': fileURLToPath(new URL('./src', import.meta.url)),
			// app.ts imports the agent modules, which import @flue/runtime/cloudflare,
			// which imports the Worker-only `cloudflare:workers` module.
			'cloudflare:workers': fileURLToPath(new URL('./src/test/cloudflare-workers.ts', import.meta.url)),
		},
	},
	test: {
		projects: [
			{
				extends: true,
				test: {
					name: 'server',
					environment: 'node',
					// Transform @flue/runtime through Vite so the `cloudflare:workers`
					// alias above reaches its import; Node's own loader cannot resolve it.
					server: { deps: { inline: [/@flue\/runtime/] } },
					include: ['src/lib/**/*.test.ts', 'src/agents/**/*.test.ts', 'src/evals/**/*.test.ts', 'src/*.test.ts'],
				},
			},
			{
				extends: true,
				test: {
					name: 'client',
					environment: 'happy-dom',
					include: ['src/client/**/*.test.{ts,tsx}'],
				},
			},
		],
	},
});
