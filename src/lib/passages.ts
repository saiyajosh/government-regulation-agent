// Windowed access to a document body, shared by the tools that let the model
// read a document piecemeal instead of receiving it whole. Library documents
// run up to several megabytes (a long Federal Register rule is over a million
// tokens on its own), so no tool result may carry an unbounded body.

// Characters returned per read_law / read_source page.
export const READ_CHUNK = 6000;

// Characters kept either side of a found phrase.
export const MATCH_WINDOW = 800;

// Bodies at or under this length travel whole; longer ones are windowed.
export const WHOLE_BODY_LIMIT = 12_000;

export function readWindow(body: string, requested: number | undefined) {
	const offset = Math.max(0, Math.min(requested ?? 0, body.length));

	return {
		offset,
		end: Math.min(offset + READ_CHUNK, body.length),
		length: body.length,
		text: body.slice(offset, offset + READ_CHUNK),
	};
}

// Up to `limit` case-insensitive occurrences of `needle`, each with its
// surrounding window, in document order.
export function findPassages(body: string, needle: string, limit = 5) {
	const haystack = body.toLowerCase();
	const term = needle.toLowerCase();
	const hits: { offset: number; text: string }[] = [];

	for (let at = haystack.indexOf(term); at !== -1 && hits.length < limit; at = haystack.indexOf(term, at + term.length)) {
		const start = Math.max(0, at - MATCH_WINDOW);
		hits.push({ offset: start, text: body.slice(start, at + term.length + MATCH_WINDOW) });
	}

	return { find: needle, matches: hits.length, passages: hits };
}
