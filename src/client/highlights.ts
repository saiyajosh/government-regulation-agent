// Passage highlighting for rendered documents, built on the CSS Custom
// Highlight API (`CSS.highlights` + `::highlight()`), which paints ranges
// without touching the DOM. That matters here because the prose tree is
// owned by React and SelectionExplain also anchors to it; wrapping text
// nodes in <mark> would break both. Browsers without the API get no
// highlights, and nothing else changes.

export interface Passage {
	text: string;
	// "cited" is a quote the agent explicitly relied on; "retrieved" is a
	// semantic-search chunk that surfaced the document. Cited wins visually.
	kind: 'cited' | 'retrieved';
}

const NAMES = { cited: 'cited-passage', retrieved: 'retrieved-passage' } as const;

// Matching happens on a lowercased copy of the text with every whitespace
// and markdown-ish character removed, so a quote survives line wrapping,
// block boundaries, emphasis markers, and smart-versus-straight quotes on
// either side. Each kept character remembers which text node it came from.
const DROP = /[\s*_`#>|\\[\]()"'“”‘’]/;

function normalize(text: string) {
	return text.toLowerCase().replace(new RegExp(DROP.source, 'g'), '');
}

// Apply a set of passages to a rendered root. Returns one anchor range per
// matched cited passage in document order (for jump-to navigation) and how
// many passages of each kind matched.
export function applyHighlights(root: HTMLElement, passages: Passage[]) {
	const registry = highlightRegistry();
	if (!registry) return { anchors: [] as Range[], matched: { cited: 0, retrieved: 0 } };

	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const chars: { node: Text; offset: number }[] = [];
	const pieces: string[] = [];
	for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
		const raw = node.data;
		for (let i = 0; i < raw.length; i++) {
			const ch = raw[i].toLowerCase();
			if (DROP.test(ch)) continue;
			chars.push({ node, offset: i });
			pieces.push(ch);
		}
	}
	const haystack = pieces.join('');

	// Search results repeat the same chunks across several queries, and a
	// cited quote often sits inside a retrieved chunk; each distinct text is
	// matched once, as its strongest kind.
	const distinct = new Map<string, Passage>();
	for (const passage of passages) {
		const key = normalize(passage.text);
		const existing = distinct.get(key);
		if (!existing || (existing.kind === 'retrieved' && passage.kind === 'cited')) distinct.set(key, passage);
	}

	const ranges = { cited: [] as Range[], retrieved: [] as Range[] };
	const anchors: Range[] = [];
	let retrievedMatched = 0;
	for (const passage of distinct.values()) {
		const found = locate(haystack, passage.text);
		if (found.length === 0) continue;
		if (passage.kind === 'retrieved') retrievedMatched += 1;
		for (const [from, to] of found) {
			const range = new Range();
			range.setStart(chars[from].node, chars[from].offset);
			range.setEnd(chars[to - 1].node, chars[to - 1].offset + 1);
			ranges[passage.kind].push(range);
			if (passage.kind === 'cited' && found[0][0] === from) anchors.push(range);
		}
	}

	const cited = new Highlight(...ranges.cited);
	cited.priority = 1;
	registry.set(NAMES.cited, cited);
	registry.set(NAMES.retrieved, new Highlight(...ranges.retrieved));
	anchors.sort((a, b) => a.compareBoundaryPoints(Range.START_TO_START, b));
	return { anchors, matched: { cited: anchors.length, retrieved: retrievedMatched } };
}

// Where a passage sits in the normalized haystack, as [from, to) spans. The
// whole passage is tried first. If it does not match as one run (a search
// chunk that spans a table, a link, or a chunk boundary mid-word), its
// lines and sentences are matched one after another, each anchored after
// the previous hit so a phrase a statute repeats is not lit up everywhere.
function locate(haystack: string, text: string): [number, number][] {
	const whole = normalize(text);
	if (whole.length < 12) return [];
	const at = haystack.indexOf(whole);
	if (at !== -1) return [[at, at + whole.length]];

	const spans: [number, number][] = [];
	let cursor = 0;
	for (const piece of text.split(/\n+|(?<=[.;:])\s+/).map(normalize)) {
		if (piece.length < 40) continue;
		const next = haystack.indexOf(piece, cursor);
		const hit = next !== -1 ? next : haystack.indexOf(piece);
		if (hit === -1) continue;
		spans.push([hit, hit + piece.length]);
		cursor = hit + piece.length;
	}
	return spans;
}

export function clearHighlights() {
	const registry = highlightRegistry();
	if (!registry) return;
	registry.delete(NAMES.cited);
	registry.delete(NAMES.retrieved);
}

export function supportsHighlights() {
	return highlightRegistry() !== null;
}

function highlightRegistry() {
	if (typeof CSS === 'undefined' || !('highlights' in CSS) || typeof Highlight === 'undefined') return null;
	return CSS.highlights;
}
