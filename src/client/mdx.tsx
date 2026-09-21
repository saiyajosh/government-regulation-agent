import { evaluate } from '@mdx-js/mdx';
import { useEffect, useState, type ComponentType } from 'react';
import * as runtime from 'react/jsx-runtime';

export function useCompiledMdx(source: string) {
	const [Content, setContent] = useState<ComponentType | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		setContent(null);
		setError(null);

		evaluate(source, { ...runtime, format: 'md' })
			.then((module) => {
				if (!cancelled) setContent(() => module.default);
			})
			.catch((err: unknown) => {
				if (!cancelled) setError(err instanceof Error ? err.message : String(err));
			});

		return () => {
			cancelled = true;
		};
	}, [source]);

	return { Content, error };
}
