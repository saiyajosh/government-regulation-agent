import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyHighlights, clearHighlights, supportsHighlights } from './highlights.ts';

// happy-dom has no CSS Custom Highlight API; this is the subset highlights.ts uses.
class FakeHighlight {
	ranges: Range[];
	priority = 0;

	constructor(...ranges: Range[]) {
		this.ranges = ranges;
	}
}

const registry = new Map<string, FakeHighlight>();

function mount(html: string) {
	const root = document.createElement('div');
	root.innerHTML = html;
	document.body.appendChild(root);

	return root;
}

describe('highlights', () => {
	beforeEach(() => {
		registry.clear();
		vi.stubGlobal('Highlight', FakeHighlight);
		vi.stubGlobal('CSS', { highlights: registry });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		document.body.innerHTML = '';
	});

	it('reports no support and applies nothing without the API', () => {
		vi.stubGlobal('CSS', {});
		const root = mount('<p>Some text that is long enough.</p>');

		expect(supportsHighlights()).toBe(false);
		expect(applyHighlights(root, [{ text: 'Some text that is long enough.', kind: 'cited' }])).toEqual({
			anchors: [],
			retrievedAnchors: [],
			matched: { cited: 0, retrieved: 0 },
		});
	});

	it('matches quotes across whitespace, markdown emphasis, and smart quotes', () => {
		const root = mount('<p>The <em>“Administrator”</em> shall\n  publish a list of categories.</p><p>Unrelated sentence here.</p>');
		const result = applyHighlights(root, [{ text: 'the "administrator" shall publish a list of categories', kind: 'cited' }]);

		expect(supportsHighlights()).toBe(true);
		expect(result.matched).toEqual({ cited: 1, retrieved: 0 });
		expect(result.anchors).toHaveLength(1);
		expect(result.anchors[0].toString()).toBe('The “Administrator” shall\n  publish a list of categories');
		expect(registry.get('cited-passage')?.ranges).toHaveLength(1);
		expect(registry.get('cited-passage')?.priority).toBe(1);
		expect(registry.get('retrieved-passage')?.ranges).toHaveLength(0);
	});

	it('lets a cited passage win over the same retrieved text and ignores short or absent passages', () => {
		const root = mount('<p>Facilities must report annually to the Administrator.</p>');

		const result = applyHighlights(root, [
			{ text: 'Facilities must report annually to the Administrator.', kind: 'retrieved' },
			{ text: 'Facilities must report annually to the Administrator.', kind: 'cited' },
			{ text: 'must report', kind: 'cited' },
			{ text: 'This sentence does not appear in the document at all.', kind: 'retrieved' },
		]);

		expect(result.matched).toEqual({ cited: 1, retrieved: 0 });
		expect(registry.get('retrieved-passage')?.ranges).toHaveLength(0);
	});

	it('falls back to sentence-by-sentence matching when a chunk does not match as one run', () => {
		const first = 'The Administrator shall establish standards of performance for each category of sources.';
		const second = 'Such standards shall reflect the degree of emission limitation achievable through the best system.';
		const root = mount(`<p>${first}</p><table><tr><td>Table noise</td></tr></table><p>${second}</p>`);
		// The chunk carries text the rendered document does not (a heading the
		// indexer kept), so it cannot match as one run.
		const result = applyHighlights(root, [{ text: `${first}\nRule 6-1 Contents\n${second}`, kind: 'retrieved' }]);

		expect(result.matched).toEqual({ cited: 0, retrieved: 1 });
		expect(registry.get('retrieved-passage')?.ranges.map((range) => range.toString())).toEqual([first, second]);
		// One anchor per retrieved passage, at its first span, so a document with
		// nothing cited can still scroll to what the search found.
		expect(result.anchors).toEqual([]);
		expect(result.retrievedAnchors.map((range) => range.toString())).toEqual([first]);
	});

	it('clearHighlights removes both registered highlights', () => {
		const root = mount('<p>Facilities must report annually to the Administrator.</p>');
		applyHighlights(root, [{ text: 'Facilities must report annually', kind: 'cited' }]);

		expect(registry.size).toBe(2);
		clearHighlights();
		expect(registry.size).toBe(0);
	});
});
