import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// Evals run the agents in-process against the live model, so they live in
// their own config: different files, a long timeout, and the .env credentials
// (CLOUDFLARE_* for the AI Gateway) loaded into the test process.
export default defineConfig({
	resolve: {
		alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
	},
	test: {
		name: 'evals',
		environment: 'node',
		include: ['src/evals/**/*.eval.ts'],
		testTimeout: 180_000,
		hookTimeout: 60_000,
		env: loadEnv('', process.cwd(), ''),
		// One Flue runtime per process: keep files in separate workers and
		// run them one at a time so the model is not hammered in parallel.
		fileParallelism: false,
	},
});
