import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocumentMatch, DocumentRecord, DocumentSummary, OpenDocument } from './types.ts';

// How many of each search's matches open on their own. The rest stay a click
// away in the result list under the search in the chat.
export const AUTO_OPEN = 2;

// The slice of a useFlueAgent message this module reads: enough to find the
// completed search_laws tool parts. Structural, so tests build messages as
// plain objects.
export interface ToolMessage {
	parts: readonly { type: string; toolName?: string; toolCallId?: string; state?: string; output?: unknown }[];
}

type Messages = readonly ToolMessage[];

// The Resources panel state: which documents are open, which is showing, and
// their fetched text. Documents enter the panel from search_laws results (the
// top AUTO_OPEN of each search automatically, any other on the user's click);
// the tools themselves never open anything.
export function useOpenDocuments(conversationId: string | null, messages: Messages) {
	const [docs, setDocs] = useState<OpenDocument[]>([]);
	const [activeKey, setActiveKey] = useState<string | null>(null);
	// Each search is applied exactly once. `messages` changes on every stream
	// chunk and keeps the full history, so without this a tab the user closed
	// would reopen (and steal focus) on the next message.
	const appliedSearches = useRef(new Set<string>());
	// Fetches in flight, so a tab closed and reopened mid-load does not fetch twice.
	const loading = useRef(new Set<string>());

	const load = useCallback((key: string) => {
		if (loading.current.has(key)) return;
		loading.current.add(key);

		void loadDocument(key).then((loaded) => {
			loading.current.delete(key);
			setDocs((current) =>
				current.map((open) => {
					if (open.key !== key) return open;

					return loaded.ok ? { ...loaded.doc, status: 'ready' } : { ...open, status: 'error', error: loaded.error };
				}),
			);
		});
	}, []);

	// Open a document: a tab already open is just selected; a new one appears
	// in the loading state and fills in when the fetch lands.
	const open = useCallback(
		(summaries: DocumentSummary[]) => {
			if (summaries.length === 0) return;
			setDocs((current) => {
				const fresh = summaries.filter((summary) => !current.some((open) => open.key === summary.key));

				return [...current, ...fresh.map((summary) => ({ ...summary, status: 'loading' as const }))];
			});
			setActiveKey(summaries[0].key);

			for (const summary of summaries) load(summary.key);
		},
		[load],
	);

	const retry = useCallback(
		(key: string) => {
			setDocs((current) => current.map((open) => (open.key === key ? { ...open, status: 'loading' } : open)));
			load(key);
		},
		[load],
	);

	const close = useCallback((key: string) => {
		setDocs((current) => {
			const next = current.filter((open) => open.key !== key);
			setActiveKey((active) => (active === key ? (next.at(-1)?.key ?? null) : active));

			return next;
		});
	}, []);

	// Switching conversations starts from a clean panel; the applied set is
	// cleared too so re-entering a conversation reopens its documents.
	useEffect(() => {
		appliedSearches.current.clear();
		setDocs([]);
		setActiveKey(null);
	}, [conversationId]);

	useEffect(() => {
		for (const search of newSearches(messages, appliedSearches.current)) {
			appliedSearches.current.add(search.toolCallId);
			open(search.matches.slice(0, AUTO_OPEN));
		}
	}, [messages, open]);

	return { docs, activeKey: activeKey ?? docs[0]?.key ?? null, open, select: setActiveKey, close, retry };
}

// The completed search_laws calls in `messages` that have not been applied
// yet, oldest first, each with its matches.
export function newSearches(messages: Messages, applied: Set<string>) {
	return messages.flatMap((message) =>
		message.parts.flatMap((part) => {
			if (part.type !== 'dynamic-tool' || part.toolName !== 'search_laws' || part.state !== 'output-available') return [];

			if (!part.toolCallId || applied.has(part.toolCallId)) return [];

			// SAFETY: search_laws' run() in regulation.ts returns the DocumentMatch
			// list; dynamic-tool parts carry that output untyped.
			return [{ toolCallId: part.toolCallId, matches: part.output as DocumentMatch[] }];
		}),
	);
}

// Keys hold slashes, which must survive as path segments.
export function documentUrl(key: string) {
	return `/api/documents/${key.split('/').map(encodeURIComponent).join('/')}`;
}

// Never rejects: a failed fetch is a state the tab shows, not an exception.
export async function loadDocument(key: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; doc: DocumentRecord } | { ok: false; error: string }> {
	const response = await fetchImpl(documentUrl(key)).catch(() => null);

	if (!response) return { ok: false, error: 'Could not reach the library. Check your connection and try again.' };

	if (response.status === 404) return { ok: false, error: 'This document is no longer in the library.' };

	if (!response.ok) return { ok: false, error: `Could not load the document (${response.status}).` };

	// SAFETY: GET /api/documents/:key in app.ts returns the DocumentRecord as JSON.
	return { ok: true, doc: (await response.json()) as DocumentRecord };
}
