export interface DocumentSummary {
	key: string;
	title: string;
	jurisdiction: string;
	citation: string;
	sourceUrl: string;
	// federal | state | regional | county | municipal
	level: string;
	// Free text, comma separated when there are several. Empty when unknown.
	authors: string;
	// Committee, agency, council, or legislature that produced the document.
	issuingBody: string;
}

export interface DocumentRecord extends DocumentSummary {
	body: string;
}

export interface DocumentMatch extends DocumentSummary {
	// Best-scoring passages from this document, highest first.
	excerpts: { text: string; score: number }[];
}

interface Frontmatter {
	title: string;
	jurisdiction: string;
	citation: string;
	sourceUrl: string;
	level: string;
	authors: string;
	issuingBody: string;
	[key: string]: string;
}

// Documents are stored as Markdown/MDX with a small `---` delimited
// frontmatter block up front (title, jurisdiction, citation, sourceUrl).
function parseFrontmatter(raw: string) {
	const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);

	const meta: Frontmatter = {
		title: '',
		jurisdiction: '',
		citation: '',
		sourceUrl: '',
		level: '',
		authors: '',
		issuingBody: '',
	};

	if (!match) return { meta, body: raw };

	for (const line of match[1].split('\n')) {
		const separator = line.indexOf(':');

		if (separator === -1) continue;
		const key = line.slice(0, separator).trim();
		const rawValue = line.slice(separator + 1).trim();
		// renderFrontmatter JSON-quotes values, so a double-quoted value is decoded
		// the same way to round-trip embedded quotes and backslashes. Only a
		// well-formed JSON string is decoded: a hand-authored value such as
		// `"The "Act" of 1990"` keeps its raw text minus the outer quotes rather
		// than throwing out of every document load that touches it.
		const value = JSON_STRING.test(rawValue) ? String(JSON.parse(rawValue)) : rawValue.replace(/^["']|["']$/g, '');

		if (key in meta) meta[key] = value;
	}

	return { meta, body: match[2] };
}

// The JSON string grammar: no raw quotes, backslashes, or control characters
// inside, and only the escapes JSON.parse accepts.
const JSON_STRING = /^"(?:[^"\\\u0000-\u001f]|\\["\\/bfnrt]|\\u[0-9a-fA-F]{4})*"$/;

export async function getDocument(bucket: R2Bucket, key: string): Promise<DocumentRecord | null> {
	const object = await bucket.get(key);

	if (!object) return null;
	const raw = await object.text();
	const { meta, body } = parseFrontmatter(raw);

	return {
		key,
		body,
		title: meta.title || key,
		jurisdiction: meta.jurisdiction || 'Unknown',
		citation: meta.citation || '',
		sourceUrl: meta.sourceUrl || '',
		level: meta.level || '',
		authors: meta.authors || '',
		issuingBody: meta.issuingBody || '',
	};
}

// Frontmatter block for a document about to be stored; values are JSON
// quoted so titles with colons or quotes round-trip through parseFrontmatter.
export function renderFrontmatter(meta: Omit<DocumentSummary, 'key'>) {
	const quote = (value: string) => JSON.stringify(value);

	return [
		'---',
		`title: ${quote(meta.title)}`,
		`jurisdiction: ${quote(meta.jurisdiction)}`,
		`level: ${quote(meta.level)}`,
		`citation: ${quote(meta.citation)}`,
		`sourceUrl: ${quote(meta.sourceUrl)}`,
		`authors: ${quote(meta.authors)}`,
		`issuingBody: ${quote(meta.issuingBody)}`,
		'---',
		'',
	].join('\n');
}

// Store a Markdown document and mirror its frontmatter into R2 custom
// metadata, which is the only place AI Search reads filterable fields from.
// Metadata must be ASCII, so section signs and dashes are normalized.
export async function putDocument(bucket: R2Bucket, key: string, raw: string): Promise<DocumentRecord> {
	const { meta } = parseFrontmatter(raw);

	const ascii = (value: string) =>
		value
			.replace(/§/g, 'Sec.')
			.replace(/[—–]/g, '-')
			.replace(/[^\x20-\x7e]/g, '')
			.trim();

	await bucket.put(key, raw, {
		httpMetadata: { contentType: 'text/markdown' },
		customMetadata: {
			jurisdiction: ascii(meta.jurisdiction),
			level: ascii(meta.level),
			citation: ascii(meta.citation),
			authors: ascii(meta.authors),
			issuing_body: ascii(meta.issuingBody),
		},
	});

	return (await getDocument(bucket, key))!;
}

// Semantic search over the library via the AI Search instance that indexes
// DOCUMENTS_BUCKET (hybrid vector + keyword retrieval, query rewriting, and
// reranking). Chunks come back keyed by R2 object key, so each hit is
// re-read from the bucket for its frontmatter: AI Search only exposes
// metadata set as x-amz-meta-* headers, which our Markdown files carry in
// frontmatter instead.
export async function searchDocuments(
	search: AiSearchInstance,
	bucket: R2Bucket,
	query: string,
	options: { jurisdiction?: string; level?: string; maxResults?: number } = {},
): Promise<DocumentMatch[]> {
	if (!query.trim()) return [];

	const filters = {
		...(options.jurisdiction && { jurisdiction: options.jurisdiction }),
		...(options.level && { level: options.level }),
	};

	const results = await search.search({
		query,
		ai_search_options: {
			retrieval: {
				retrieval_type: 'hybrid',
				// The instance defaults keyword matching to "and", which drops
				// natural-language queries whose every word is not in a chunk.
				keyword_match_mode: 'or',
				max_num_results: options.maxResults ?? 12,
				// Filter fields must exist in the instance's custom metadata schema
				// (see README); AI Search rejects a filter on an unknown field.
				...(Object.keys(filters).length > 0 && { filters }),
			},
			query_rewrite: { enabled: true },
			reranking: { enabled: true },
			// The similarity cache would serve one question's chunks to a
			// near-duplicate phrasing; retrieval is cheap enough to skip it.
			cache: { enabled: false },
		},
	});

	const byKey = new Map<string, { text: string; score: number }[]>();

	for (const chunk of results.chunks) {
		const excerpts = byKey.get(chunk.item.key) ?? [];
		// The first chunk of a file includes its frontmatter; drop it from the excerpt.
		const text = chunk.text.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();

		if (text) excerpts.push({ text, score: chunk.score });
		byKey.set(chunk.item.key, excerpts);
	}

	const matches = await Promise.all(
		[...byKey].map(async ([key, excerpts]) => {
			const doc = await getDocument(bucket, key);

			if (!doc) return null;

			return {
				key,
				title: doc.title,
				jurisdiction: doc.jurisdiction,
				citation: doc.citation,
				sourceUrl: doc.sourceUrl,
				level: doc.level,
				authors: doc.authors,
				issuingBody: doc.issuingBody,
				excerpts: excerpts.sort((a, b) => b.score - a.score),
			};
		}),
	);

	// Chunks arrive ranked, so documents keep the order of their best chunk.
	return matches.filter((match): match is DocumentMatch => match !== null);
}
