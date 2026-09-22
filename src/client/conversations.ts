import { useCallback, useEffect, useRef, useState } from 'react';
import { isUntouched, type ConversationRecord } from '../lib/conversations.ts';

const CURRENT_STORAGE_KEY = 'gra:conversation-id';

// The caller's conversations and which one is open. Ids are server-issued and
// owned by the cookie identity, so the client never mints one itself; the
// last-open id is remembered per browser and validated against the list on
// load (a stale or foreign id just falls through to a new conversation).
export function useConversations() {
	const [userId, setUserId] = useState<string | null>(null);
	const [conversations, setConversations] = useState<ConversationRecord[]>([]);
	const [currentId, setCurrentId] = useState<string | null>(null);

	// Bootstrap outcome. Until 'ready' the agent stays dormant, so a failed
	// bootstrap has to be surfaced or the chat is silently dead.
	const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; error: string | null }>({
		status: 'loading',
		error: null,
	});

	const refresh = useCallback(async () => {
		const res = await fetch('/api/conversations');

		if (!res.ok) throw new Error(`Failed to load conversations (${res.status})`);
		// SAFETY: GET /api/conversations in app.ts responds with
		// `{ userId, conversations: listConversations(...) }`, whose entries are
		// the same ConversationRecord entries this hook renders.
		const data = (await res.json()) as { userId: string; conversations: ConversationRecord[] };
		setUserId(data.userId);
		setConversations(data.conversations);

		return data;
	}, []);

	// An untouched conversation (never prompted) is reused rather than
	// stacking empties in the list. The server is the source of truth for
	// untouched-ness: the first prompt stamps the record there before the
	// local list catches up (it only refreshes once a reply settles), so the
	// decision is made against a fresh list unless the caller already has one.
	const create = useCallback(
		async (existing?: ConversationRecord[]) => {
			const fresh = existing ?? (await refresh()).conversations;
			const empty = fresh.find((c) => isUntouched(c));

			if (empty) {
				select(empty.id);

				return empty;
			}

			const res = await fetch('/api/conversations', { method: 'POST' });

			if (!res.ok) throw new Error(`Failed to create conversation (${res.status})`);
			// SAFETY: POST /api/conversations in app.ts responds with the single
			// record from createConversation(...), the same shape as a list entry.
			const record = (await res.json()) as ConversationRecord;
			setConversations((all) => [record, ...all]);
			select(record.id);

			return record;
		},
		[refresh],
	);

	// Rejections here are the Errors thrown above (or a fetch TypeError).
	const fail = useCallback((error: Error) => {
		setState({ status: 'error', error: error.message });
	}, []);

	const boot = useCallback(() => {
		setState({ status: 'loading', error: null });

		return refresh()
			.then((data) => {
				const remembered = readRemembered();

				if (remembered && data.conversations.some((c) => c.id === remembered)) {
					select(remembered);

					return;
				}

				return create(data.conversations);
			})
			.then(() => setState({ status: 'ready', error: null }))
			.catch(fail);
	}, [refresh, create, fail]);

	// Bootstrap once; the ref keeps StrictMode's double effect run from
	// creating two conversations.
	const booted = useRef(false);
	useEffect(() => {
		if (booted.current) return;
		booted.current = true;
		void boot();
	}, [boot]);

	function select(id: string) {
		setCurrentId(id);

		try {
			localStorage.setItem(CURRENT_STORAGE_KEY, id);
		} catch {
			// Per-browser convenience only; nothing depends on it persisting.
		}
	}

	// The snippet is cosmetic, so a failed PATCH is left alone rather than
	// surfaced. The response is applied locally instead of refetching the list:
	// KV list reads are eventually consistent and can miss the write briefly.
	async function reportSnippet(id: string, snippet: string) {
		const res = await fetch(`/api/conversations/${id}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ snippet }),
		});

		if (!res.ok) return;
		// SAFETY: PATCH /api/conversations/:id in app.ts responds with the
		// updated record from updateConversation(...), the same shape as a list entry.
		const record = (await res.json()) as ConversationRecord;
		setConversations((all) =>
			[record, ...all.filter((c) => c.id !== record.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
		);
	}

	return {
		userId,
		conversations,
		currentId,
		status: state.status,
		error: state.error,
		select,
		create: () => create().catch(fail),
		refresh,
		reportSnippet,
		retry: boot,
	};
}

function readRemembered() {
	try {
		return localStorage.getItem(CURRENT_STORAGE_KEY);
	} catch {
		return null;
	}
}
