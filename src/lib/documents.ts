export interface DocumentSummary {
	key: string;
	title: string;
	jurisdiction: string;
	citation: string;
	sourceUrl: string;
}

export interface DocumentRecord extends DocumentSummary {
	body: string;
}

interface Frontmatter {
	title: string;
	jurisdiction: string;
	citation: string;
	sourceUrl: string;
	[key: string]: string;
}

// Documents are stored as Markdown/MDX with a small `---` delimited
// frontmatter block up front (title, jurisdiction, citation, sourceUrl).
function parseFrontmatter(raw: string): { meta: Frontmatter; body: string } {
	const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
	const meta: Frontmatter = { title: '', jurisdiction: '', citation: '', sourceUrl: '' };

	if (!match) return { meta, body: raw };

	for (const line of match[1].split('\n')) {
		const separator = line.indexOf(':');

		if (separator === -1) continue;
		const key = line.slice(0, separator).trim();
		const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');

		if (key in meta) meta[key] = value;
	}

	return { meta, body: match[2] };
}

// Internal: scans the whole bucket. Fine while the library is small; search
// should move to an index before the library grows to thousands of documents.
async function listDocuments(bucket: R2Bucket): Promise<DocumentSummary[]> {
	const listed = await bucket.list();

	const summaries = await Promise.all(
		listed.objects.map((object) => getDocument(bucket, object.key)),
	);

	return summaries.filter((doc): doc is DocumentRecord => doc !== null);
}

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
	};
}

export async function searchDocuments(bucket: R2Bucket, query: string): Promise<DocumentSummary[]> {
	const needle = query.trim().toLowerCase();

	if (!needle) return [];
	const docs = await listDocuments(bucket);

	return docs.filter((doc) =>
		[doc.title, doc.jurisdiction, doc.citation, doc.key].some((field) =>
			field.toLowerCase().includes(needle),
		),
	);
}
