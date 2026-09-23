import { describe, expect, it } from 'vitest';
import { highlightCalls } from './harness.ts';

describe('highlightCalls', () => {
	it('collects highlight_passages calls and passages carried on open_law', () => {
		const calls = [
			{ name: 'search_laws', input: { query: 'q' } },
			{ name: 'open_law', input: { key: 'a.md', passages: ['first', 'second'] } },
			{ name: 'open_law', input: { key: 'b.md' } },
			{ name: 'open_law', input: { key: 'c.md', passages: [] } },
			{ name: 'highlight_passages', input: { key: 'b.md', passages: ['third'] } },
		];

		expect(highlightCalls(calls)).toEqual([
			{ key: 'a.md', passages: ['first', 'second'] },
			{ key: 'b.md', passages: ['third'] },
		]);
	});

	it('rejects a call whose input does not match the tool schema', () => {
		expect(() => highlightCalls([{ name: 'highlight_passages', input: { key: 'a.md' } }])).toThrow();
	});
});
