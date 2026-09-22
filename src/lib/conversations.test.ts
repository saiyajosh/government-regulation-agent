import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeKv } from '../test/fakes.ts';
import {
	createConversation,
	DEFAULT_TITLE,
	getConversation,
	isUntouched,
	listConversations,
	updateConversation,
} from './conversations.ts';

describe('isUntouched', () => {
	it('is true only with no snippet and equal timestamps', () => {
		expect(isUntouched({ snippet: '', createdAt: 't', updatedAt: 't' })).toBe(true);
		expect(isUntouched({ snippet: 'x', createdAt: 't', updatedAt: 't' })).toBe(false);
		expect(isUntouched({ snippet: '', createdAt: 't', updatedAt: 'u' })).toBe(false);
	});
});

describe('conversation index', () => {
	afterEach(() => vi.useRealTimers());

	it('creates a record under the user prefix with metadata mirroring the value', async () => {
		const kv = fakeKv();
		const record = await createConversation(kv, 'u1', 'u1.c1');

		expect(record).toMatchObject({ id: 'u1.c1', title: DEFAULT_TITLE, snippet: '' });
		expect(record.createdAt).toBe(record.updatedAt);
		expect(kv.entries.get('user:u1:conv:u1.c1')?.metadata).toEqual({
			title: DEFAULT_TITLE,
			snippet: '',
			createdAt: record.createdAt,
			updatedAt: record.updatedAt,
		});
		expect(await getConversation(kv, 'u1', 'u1.c1')).toEqual(record);
	});

	it('updates title and snippet, clipping to one line and a maximum length', async () => {
		const kv = fakeKv();
		await createConversation(kv, 'u1', 'u1.c1');

		const updated = await updateConversation(kv, 'u1', 'u1.c1', {
			title: `  multi\n line   ${'x'.repeat(100)}`,
			snippet: 'short',
		});

		expect(updated?.title).toHaveLength(80);
		expect(updated?.title.endsWith('…')).toBe(true);
		expect(updated?.title.startsWith('multi line x')).toBe(true);
		expect(updated?.snippet).toBe('short');
		expect(isUntouched(updated!)).toBe(false);
		expect(await updateConversation(kv, 'u1', 'u1.missing', { snippet: 's' })).toBeNull();
	});

	it('lists only the caller’s conversations, newest first, across list pages', async () => {
		vi.useFakeTimers({ now: new Date('2026-01-01T00:00:00Z') });
		const kv = fakeKv(2);
		const ids = ['u1.a', 'u1.b', 'u1.c', 'u1.d', 'u1.e'];

		for (const id of ids) {
			await createConversation(kv, 'u1', id);
			vi.advanceTimersByTime(1000);
		}

		await createConversation(kv, 'u2', 'u2.z');
		vi.advanceTimersByTime(1000);
		await updateConversation(kv, 'u1', 'u1.b', { snippet: 'latest' });

		const listed = await listConversations(kv, 'u1');

		expect(listed).toHaveLength(5);
		expect(listed[0].id).toBe('u1.b');
		expect(listed.map((record) => record.id)).not.toContain('u2.z');
	});
});
