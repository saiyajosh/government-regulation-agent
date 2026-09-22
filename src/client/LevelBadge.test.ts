import { describe, expect, it } from 'vitest';
import { jurisdictionLabel, LEVELS } from './LevelBadge.tsx';

describe('jurisdictionLabel', () => {
	it('hides the jurisdiction when it merely repeats the level label', () => {
		expect(jurisdictionLabel('federal', 'Federal')).toBeNull();
		expect(jurisdictionLabel('federal', 'federal')).toBeNull();
		expect(jurisdictionLabel('regional', 'Air District')).toBeNull();
	});

	it('shows a jurisdiction that adds information, and nothing for an empty one', () => {
		expect(jurisdictionLabel('state', 'California')).toBe('California');
		expect(jurisdictionLabel('municipal', 'Oakland, California')).toBe('Oakland, California');
		expect(jurisdictionLabel('unknown-level', 'Somewhere')).toBe('Somewhere');
		expect(jurisdictionLabel('federal', '')).toBeNull();
	});

	it('covers every level the search tool accepts', () => {
		expect([...LEVELS.keys()]).toEqual(['federal', 'state', 'regional', 'county', 'municipal']);
	});
});
