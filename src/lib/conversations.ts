// Per-user conversation index in KV. One key per conversation, namespaced by
// user id, so `list({ prefix })` returns everything a user owns; listing pages
// through the cursor since KV caps each page at 1000 keys.
// The list-view fields (title, snippet, timestamps) are duplicated into KV
// metadata (≤ 1024 bytes) so listing never has to read values. The value is
// the same record; it exists so a future move to D1 or a Durable Object is a
// storage swap, not a redesign.
export interface ConversationRecord {
	id: string;
	title: string;
	snippet: string;
	createdAt: string;
	updatedAt: string;
}

type Metadata = Omit<ConversationRecord, 'id'>;

export const DEFAULT_TITLE = 'New conversation';

// A conversation is untouched until its first prompt is stamped (which bumps
// updatedAt) or a snippet lands. The title is not consulted, so a user whose
// first prompt is literally the default title still counts as touched.
export function isUntouched(record: Pick<ConversationRecord, 'snippet' | 'createdAt' | 'updatedAt'>) {
	return !record.snippet && record.createdAt === record.updatedAt;
}

const TITLE_MAX = 80;

const SNIPPET_MAX = 160;

function key(userId: string, conversationId: string) {
	return `user:${userId}:conv:${conversationId}`;
}

export async function createConversation(
	kv: KVNamespace,
	userId: string,
	conversationId: string,
): Promise<ConversationRecord> {
	const now = new Date().toISOString();
	const record = { id: conversationId, title: DEFAULT_TITLE, snippet: '', createdAt: now, updatedAt: now };
	await write(kv, userId, record);

	return record;
}

export async function listConversations(kv: KVNamespace, userId: string) {
	const keys: KVNamespaceListKey<Metadata>[] = [];
	let cursor: string | undefined;

	do {
		const page = await kv.list<Metadata>({ prefix: key(userId, ''), cursor, limit: 1000 });

		keys.push(...page.keys);
		cursor = page.list_complete ? undefined : page.cursor;
	} while (cursor);

	return keys
		.flatMap((entry) => {
			if (!entry.metadata) return [];

			return [{ id: entry.name.slice(key(userId, '').length), ...entry.metadata }];
		})
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getConversation(kv: KVNamespace, userId: string, conversationId: string) {
	return kv.get<ConversationRecord>(key(userId, conversationId), 'json');
}

// Read-modify-write; KV has no conditional writes, which is acceptable here
// because the two writers are disjoint in time: the server stamps the title
// exactly once, on the first prompt, before any reply can settle, and every
// later write is the client's snippet report after a reply settles.
export async function updateConversation(
	kv: KVNamespace,
	userId: string,
	conversationId: string,
	patch: Partial<Pick<ConversationRecord, 'title' | 'snippet'>>,
) {
	const current = await getConversation(kv, userId, conversationId);

	if (!current) return null;

	const record = {
		...current,
		title: patch.title === undefined ? current.title : clip(patch.title, TITLE_MAX),
		snippet: patch.snippet === undefined ? current.snippet : clip(patch.snippet, SNIPPET_MAX),
		updatedAt: new Date().toISOString(),
	};

	await write(kv, userId, record);

	return record;
}

async function write(kv: KVNamespace, userId: string, record: ConversationRecord) {
	const metadata: Metadata = {
		title: record.title,
		snippet: record.snippet,
		createdAt: record.createdAt,
		updatedAt: record.updatedAt,
	};

	await kv.put(key(userId, record.id), JSON.stringify(record), { metadata });
}

function clip(text: string, max: number) {
	const oneLine = text.replace(/\s+/g, ' ').trim();

	return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1).trimEnd()}…`;
}
