import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTO_OPEN, documentUrl, loadDocument, newSearches, useOpenDocuments, type ToolMessage } from './documents.ts';
import type { DocumentMatch } from './types.ts';

const match = (key: string): DocumentMatch => ({
	key,
	title: `Title of ${key}`,
	jurisdiction: 'Federal',
	citation: '',
	sourceUrl: '',
	level: 'federal',
	authors: '',
	issuingBody: '',
	excerpts: [],
});

function searchMessage(toolCallId: string, matches: DocumentMatch[], state = 'output-available'): ToolMessage {
	return { parts: [{ type: 'dynamic-tool', toolName: 'search_laws', toolCallId, state, output: matches }] };
}

const NO_MESSAGES: ToolMessage[] = [];

describe('documentUrl', () => {
	it('keeps the slashes of a key as path segments and escapes the rest', () => {
		expect(documentUrl('federal/cfr/40 cfr 98.2.md')).toBe('/api/documents/federal/cfr/40%20cfr%2098.2.md');
	});
});

describe('newSearches', () => {
	it('yields each completed search once, in order, and skips running ones', () => {
		const applied = new Set(['done']);

		const messages = [
			searchMessage('done', [match('a')]),
			searchMessage('running', [], 'input-available'),
			searchMessage('fresh', [match('b'), match('c')]),
		];

		expect(newSearches(messages, applied)).toEqual([{ toolCallId: 'fresh', matches: [match('b'), match('c')] }]);
	});
});

describe('loadDocument', () => {
	it('returns the record, and turns a 404 or a network failure into a readable error', async () => {
		const record = { ...match('a'), body: 'text' };
		const ok = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(record)));

		expect(await loadDocument('a', ok)).toEqual({ ok: true, doc: record });
		expect(ok).toHaveBeenCalledWith('/api/documents/a');

		const missing: typeof fetch = async () => new Response('', { status: 404 });

		expect(await loadDocument('a', missing)).toEqual({ ok: false, error: 'This document is no longer in the library.' });

		const offline: typeof fetch = () => Promise.reject(new Error('offline'));

		expect(await loadDocument('a', offline)).toMatchObject({ ok: false, error: expect.stringContaining('Could not reach') });
	});
});

describe('useOpenDocuments', () => {
	const bodies = new Map([
		['a', 'body a'],
		['b', 'body b'],
		['c', 'body c'],
	]);

	afterEach(() => vi.unstubAllGlobals());

	function stubFetch() {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string) => {
				const key = url.replace('/api/documents/', '');

				const body = bodies.get(key);

				if (body === undefined) return new Response('', { status: 404 });

				return new Response(JSON.stringify({ ...match(key), body }));
			}),
		);
	}

	it('opens the top matches of each new search as loading tabs and fills them in', async () => {
		stubFetch();
		const matches = [match('a'), match('b'), match('c')];

		const { result, rerender } = renderHook(({ messages }) => useOpenDocuments('conv', messages), {
			initialProps: { messages: NO_MESSAGES },
		});

		expect(result.current.docs).toEqual([]);

		rerender({ messages: [searchMessage('call-1', matches)] });

		expect(result.current.docs.map((doc) => doc.key)).toEqual(matches.slice(0, AUTO_OPEN).map((doc) => doc.key));
		expect(result.current.docs.every((doc) => doc.status === 'loading')).toBe(true);
		expect(result.current.activeKey).toBe('a');

		await waitFor(() => expect(result.current.docs.every((doc) => doc.status === 'ready')).toBe(true));
		expect(result.current.docs[1]).toMatchObject({ key: 'b', status: 'ready', body: 'body b' });

		// The same messages again (a new stream chunk) do not reopen anything.
		act(() => result.current.close('a'));
		rerender({ messages: [searchMessage('call-1', matches)] });

		expect(result.current.docs.map((doc) => doc.key)).toEqual(['b']);
		expect(result.current.activeKey).toBe('b');
	});

	it('opens a result on demand, selects an already open one, and reports fetch failures with a retry', async () => {
		stubFetch();
		const { result } = renderHook(() => useOpenDocuments('conv', NO_MESSAGES));

		act(() => result.current.open([match('a')]));
		act(() => result.current.open([match('missing')]));

		expect(result.current.docs.map((doc) => doc.key)).toEqual(['a', 'missing']);
		expect(result.current.activeKey).toBe('missing');

		await waitFor(() => expect(result.current.docs[1].status).toBe('error'));
		expect(result.current.docs[1]).toMatchObject({ error: 'This document is no longer in the library.' });

		act(() => result.current.open([match('a')]));

		expect(result.current.docs).toHaveLength(2);
		expect(result.current.activeKey).toBe('a');

		bodies.set('missing', 'found after all');
		act(() => result.current.retry('missing'));

		expect(result.current.docs[1].status).toBe('loading');
		await waitFor(() => expect(result.current.docs[1]).toMatchObject({ status: 'ready', body: 'found after all' }));
		bodies.delete('missing');
	});

	it('starts from an empty panel when the conversation changes', async () => {
		stubFetch();
		const first: string | null = 'one';

		const { result, rerender } = renderHook(({ id }) => useOpenDocuments(id, [searchMessage('call-1', [match('a')])]), {
			initialProps: { id: first },
		});

		await waitFor(() => expect(result.current.docs[0]?.status).toBe('ready'));

		rerender({ id: 'two' });

		// The search is re-applied for the new conversation's messages (which in
		// the app are that conversation's own history).
		await waitFor(() => expect(result.current.docs.map((doc) => doc.key)).toEqual(['a']));
	});
});
