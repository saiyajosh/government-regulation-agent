import { describe, expect, it } from 'vitest';
import { highlightCalls, highlightedKeys, readKeys } from './harness.ts';

describe('tool call views', () => {
	const calls = [
		{ name: 'search_laws', input: { query: 'q' } },
		{ name: 'read_law', input: { key: 'a.md', find: 'x' } },
		{ name: 'highlight_passages', input: { key: 'a.md', passages: ['first', 'second'] } },
		{ name: 'highlight_passages', input: { key: 'b.md', passages: ['third'] } },
	];

	it('collect highlight_passages calls and the keys they name', () => {
		expect(highlightCalls(calls)).toEqual([
			{ key: 'a.md', passages: ['first', 'second'] },
			{ key: 'b.md', passages: ['third'] },
		]);
		expect(highlightedKeys(calls)).toEqual(['a.md', 'b.md']);
		expect(readKeys(calls)).toEqual(['a.md']);
	});

	it('reject a call whose input does not match the tool schema', () => {
		expect(() => highlightCalls([{ name: 'highlight_passages', input: { key: 'a.md' } }])).toThrow();
	});
});
