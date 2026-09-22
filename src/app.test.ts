import { beforeEach, describe, expect, it } from 'vitest';
import app, { type AppEnv } from './app.ts';
import { renderFrontmatter } from './lib/documents.ts';
import { fakeBucket, fakeKv } from './test/fakes.ts';

function testEnv() {
	return {
		CONVERSATIONS: fakeKv(),
		DOCUMENTS_BUCKET: fakeBucket(),
		AI: {
			async toMarkdown(file: { name: string; blob: Blob }) {
				return {
					id: '1',
					name: file.name,
					mimeType: 'application/pdf',
					format: 'markdown' as const,
					tokens: 1,
					data: `# ${file.name}\n## Metadata\n- pages: 1\n- foo: bar\nConverted body`,
				};
			},
		},
		SEED_TOKEN: 'seed-token',
		COOKIE_SECRET: 'cookie-secret',
	} satisfies AppEnv;
}

// The identity cookie a response set, in the form a browser would send it back.
function cookieOf(response: Response) {
	return response.headers.get('set-cookie')?.split(';')[0] ?? '';
}

describe('identity and conversations', () => {
	let env: ReturnType<typeof testEnv>;

	beforeEach(() => {
		env = testEnv();
	});

	it('mints a signed identity cookie on first contact and keeps it on later requests', async () => {
		const first = await app.request('/api/conversations', {}, env);
		const cookie = cookieOf(first);
		const firstBody = await first.json<{ userId: string; conversations: unknown[] }>();

		expect(first.status).toBe(200);
		expect(cookie).toMatch(/^gra_uid=/);
		expect(first.headers.get('set-cookie')).toContain('HttpOnly');
		expect(firstBody.conversations).toEqual([]);

		const second = await app.request('/api/conversations', { headers: { cookie } }, env);

		expect(second.headers.get('set-cookie')).toBeNull();
		expect((await second.json<{ userId: string }>()).userId).toBe(firstBody.userId);
	});

	it('rejects a tampered cookie by issuing a fresh identity', async () => {
		const first = await app.request('/api/conversations', {}, env);
		const forged = cookieOf(first).replace(/=([a-f0-9]{8})/, '=deadbeef');
		const second = await app.request('/api/conversations', { headers: { cookie: forged } }, env);

		expect((await second.json<{ userId: string }>()).userId).not.toBe(
			(await first.json<{ userId: string }>()).userId,
		);
	});

	it('creates, lists, and patches only the owner’s conversations', async () => {
		const first = await app.request('/api/conversations', {}, env);
		const cookie = cookieOf(first);
		const userId = (await first.json<{ userId: string }>()).userId;

		const created = await app.request('/api/conversations', { method: 'POST', headers: { cookie } }, env);
		const record = await created.json<{ id: string; title: string }>();

		expect(created.status).toBe(201);
		expect(record.id.startsWith(`${userId}.`)).toBe(true);
		expect(record.title).toBe('New conversation');

		const patched = await app.request(
			`/api/conversations/${record.id}`,
			{ method: 'PATCH', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ snippet: 'A reply' }) },
			env,
		);

		expect(patched.status).toBe(200);
		expect((await patched.json<{ snippet: string }>()).snippet).toBe('A reply');

		const listed = await app.request('/api/conversations', { headers: { cookie } }, env);

		expect((await listed.json<{ conversations: { id: string; snippet: string }[] }>()).conversations).toEqual([
			expect.objectContaining({ id: record.id, snippet: 'A reply' }),
		]);

		const foreign = await app.request(
			`/api/conversations/${record.id}`,
			{ method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ snippet: 'x' }) },
			env,
		);

		expect(foreign.status).toBe(403);

		const missing = await app.request(
			`/api/conversations/${userId}.unknown`,
			{ method: 'PATCH', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ snippet: 'x' }) },
			env,
		);

		expect(missing.status).toBe(404);
	});

	it('refuses agent requests for a conversation the caller does not own before reaching the agent', async () => {
		const response = await app.request(
			'/agents/regulation-agent/someoneelse.abc',
			{ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'user', body: 'hi' }) },
			env,
		);

		expect(response.status).toBe(403);
	});
});

describe('documents', () => {
	const raw = `${renderFrontmatter({
		title: 'Rule 2-1',
		jurisdiction: 'Bay Area',
		level: 'regional',
		citation: 'BAAQMD Reg. 2, Rule 1',
		sourceUrl: '',
		authors: '',
		issuingBody: 'BAAQMD',
	})}Body`;

	it('reads a document by nested key and 404s when missing', async () => {
		const env = testEnv();
		env.DOCUMENTS_BUCKET.objects.set('regional/baaqmd/2-1.md', raw);

		const found = await app.request('/api/documents/regional/baaqmd/2-1.md', {}, env);

		expect(found.status).toBe(200);
		expect(await found.json()).toMatchObject({ key: 'regional/baaqmd/2-1.md', title: 'Rule 2-1', body: 'Body' });
		expect((await app.request('/api/documents/nope.md', {}, env)).status).toBe(404);
	});

	it('requires the seed token to ingest or delete', async () => {
		const env = testEnv();

		expect((await app.request('/api/documents/a.md', { method: 'PUT', body: raw }, env)).status).toBe(401);
		expect(
			(await app.request('/api/documents/a.md', { method: 'PUT', body: raw, headers: { authorization: 'Bearer wrong' } }, env)).status,
		).toBe(401);
		expect((await app.request('/api/documents', { method: 'DELETE' }, env)).status).toBe(401);
	});

	it('refuses ingest when no token is configured at all', async () => {
		const env = { ...testEnv(), SEED_TOKEN: undefined };

		expect(
			(await app.request('/api/documents/a.md', { method: 'PUT', body: raw, headers: { authorization: 'Bearer undefined' } }, env)).status,
		).toBe(401);
	});

	it('ingests Markdown and mirrors frontmatter into custom metadata', async () => {
		const env = testEnv();

		const response = await app.request(
			'/api/documents/regional/baaqmd/2-1.md',
			{ method: 'PUT', body: raw, headers: { authorization: 'Bearer seed-token', 'content-type': 'text/markdown' } },
			env,
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ key: 'regional/baaqmd/2-1.md', title: 'Rule 2-1', jurisdiction: 'Bay Area', bytes: raw.length });
		expect(env.DOCUMENTS_BUCKET.metadata.get('regional/baaqmd/2-1.md')).toMatchObject({ jurisdiction: 'Bay Area', level: 'regional' });
	});

	it('converts a PDF with Workers AI, takes frontmatter from headers, and strips the conversion preamble', async () => {
		const env = testEnv();

		const response = await app.request(
			'/api/documents/federal/fr/rule.md',
			{
				method: 'PUT',
				body: new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
				headers: {
					authorization: 'Bearer seed-token',
					'content-type': 'application/pdf',
					'x-doc-title': 'A Final Rule',
					'x-doc-jurisdiction': 'Federal',
					'x-doc-level': 'federal',
					'x-doc-citation': '90 FR 1',
				},
			},
			env,
		);

		expect(response.status).toBe(200);
		expect(env.DOCUMENTS_BUCKET.objects.get('federal/fr/rule.md')).toBe(
			`${renderFrontmatter({ title: 'A Final Rule', jurisdiction: 'Federal', level: 'federal', citation: '90 FR 1', sourceUrl: '', authors: '', issuingBody: '' })}Converted body`,
		);
	});

	it('returns 422 when the PDF conversion fails', async () => {
		const env = {
			...testEnv(),
			AI: {
				async toMarkdown(file: { name: string }) {
					return { id: '1', name: file.name, mimeType: 'application/pdf', format: 'error' as const, tokens: 0, data: '', error: 'unreadable' };
				},
			},
		};

		const response = await app.request(
			'/api/documents/x.md',
			{ method: 'PUT', body: new Blob(['x']), headers: { authorization: 'Bearer seed-token', 'content-type': 'application/pdf' } },
			env,
		);

		expect(response.status).toBe(422);
		expect(await response.json()).toEqual({ error: 'unreadable' });
	});

	it('deletes everything under a prefix', async () => {
		const env = testEnv();
		env.DOCUMENTS_BUCKET.objects.set('federal/a.md', raw);
		env.DOCUMENTS_BUCKET.objects.set('federal/b.md', raw);
		env.DOCUMENTS_BUCKET.objects.set('state/c.md', raw);

		const response = await app.request('/api/documents?prefix=federal/', { method: 'DELETE', headers: { authorization: 'Bearer seed-token' } }, env);

		expect(await response.json()).toEqual({ deleted: 2, prefix: 'federal/' });
		expect([...env.DOCUMENTS_BUCKET.objects.keys()]).toEqual(['state/c.md']);
	});
});
