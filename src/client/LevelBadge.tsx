import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// One color per level of government so a reader can tell an EPA rule from a
// CARB regulation from an air district rule at a glance. `surface` is the
// tinted card variant the welcome screen uses for the same three scopes.
export const LEVELS: Record<string, { label: string; badge: string; surface: string }> = {
	federal: {
		label: 'Federal',
		badge: 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100',
		surface: 'border-sky-200 bg-sky-50/50 dark:border-sky-900 dark:bg-sky-950/30',
	},
	state: {
		label: 'State',
		badge: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100',
		surface: 'border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/30',
	},
	regional: {
		label: 'Air district',
		badge: 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100',
		surface: 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/30',
	},
	county: {
		label: 'County',
		badge: 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-100',
		surface: 'border-rose-200 bg-rose-50/50 dark:border-rose-900 dark:bg-rose-950/30',
	},
	municipal: {
		label: 'City',
		badge: 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-100',
		surface: 'border-rose-200 bg-rose-50/50 dark:border-rose-900 dark:bg-rose-950/30',
	},
};

// The same badge everywhere a level shows up (document header, tool call
// cards): same label casing and colors, only the size differs.
export function LevelBadge({
	level,
	size = 'md',
	className,
}: {
	level: string;
	size?: 'sm' | 'md';
	className?: string;
}) {
	const style = LEVELS[level];
	if (!style) return null;
	return (
		<Badge
			variant="outline"
			className={cn(size === 'md' ? 'h-6 px-2.5 text-[13px]' : 'h-4 px-1.5 text-[10px]', style.badge, className)}
		>
			{style.label}
		</Badge>
	);
}

// Federal documents name their jurisdiction "Federal" too, which would put
// two identical badges side by side; the level badge alone is enough then.
export function jurisdictionLabel(level: string, jurisdiction: string) {
	if (!jurisdiction) return null;
	if (jurisdiction.toLowerCase() === LEVELS[level]?.label.toLowerCase()) return null;
	return jurisdiction;
}
