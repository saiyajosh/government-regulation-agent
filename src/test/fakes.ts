import type { ConversationIndex } from '../lib/conversations.ts';
import type { DocumentSearcher, DocumentStore } from '../lib/documents.ts';

// In-memory stand-ins for the Cloudflare bindings, shaped by the structural
// interfaces each module declares. They keep just enough state for tests to
// assert on what was written.

export function fakeBucket(initial: Record<string, string> = {}) {
	const objects = new Map(Object.entries(initial));
	const metadata = new Map<string, Record<string, string>>();

	const bucket: DocumentStore & {
		objects: Map<string, string>;
		metadata: Map<string, Record<string, string>>;
		list(options: { prefix: string }): Promise<{ objects: { key: string }[]; truncated: false }>;
		delete(keys: string | string[]): Promise<void>;
	} = {
		objects,
		metadata,
		async get(key) {
			const raw = objects.get(key);

			return raw === undefined ? null : { text: async () => raw };
		},
		async put(key, value, options) {
			objects.set(key, value);
			metadata.set(key, options.customMetadata);

			return null;
		},
		async list(options) {
			return {
				objects: [...objects.keys()].flatMap((key) => (key.startsWith(options.prefix) ? [{ key }] : [])),
				truncated: false,
			};
		},
		async delete(keys) {
			for (const key of Array.isArray(keys) ? keys : [keys]) objects.delete(key);
		},
	};

	return bucket;
}

export type Chunk = { key: string; text: string; score: number };

// Returns the given chunks for every query and records each request so tests
// can assert on the retrieval options the caller built.
export function fakeSearch(chunks: Chunk[]) {
	const requests: AiSearchSearchRequest[] = [];

	const search: DocumentSearcher & { requests: AiSearchSearchRequest[] } = {
		requests,
		async search(params) {
			requests.push(params);

			return {
				search_query: params.query ?? '',
				chunks: chunks.map((chunk, index) => ({
					id: `chunk-${index}`,
					type: 'text',
					score: chunk.score,
					text: chunk.text,
					item: { key: chunk.key },
				})),
			};
		},
	};

	return search;
}

export function fakeKv(pageSize = 1000) {
	const entries = new Map<string, { value: string; metadata: unknown }>();

	const kv: ConversationIndex & { entries: typeof entries } = {
		entries,
		async get(key) {
			const entry = entries.get(key);

			// SAFETY: the caller chose the JSON type parameter; the stored value is the JSON it wrote.
			return entry === undefined ? null : (JSON.parse(entry.value) as never);
		},
		async put(key, value, options) {
			entries.set(key, { value, metadata: options.metadata });
		},
		async list(options) {
			const limit = Math.min(options.limit, pageSize);
			const start = options.cursor ? Number(options.cursor) : 0;
			const names = [...entries.keys()].filter((name) => name.startsWith(options.prefix)).sort();
			// SAFETY: the caller chose the metadata type parameter; metadata is what it stored.
			const keys = names.slice(start, start + limit).map((name) => ({ name, metadata: entries.get(name)!.metadata as never }));

			if (start + limit >= names.length) return { list_complete: true, keys, cacheStatus: null };

			return { list_complete: false, keys, cursor: String(start + limit), cacheStatus: null };
		},
	};

	return kv;
}
