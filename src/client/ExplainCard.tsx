import { useFlueAgent } from '@flue/react';
import { ExternalLink, Globe, Loader2, MessageCircleQuestion, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { ExplainInput } from '../lib/explain.ts';

// The floating prompt that appears under a fresh selection. It only collects
// the question; the answer lives in an ExplainCard inserted below the block.
export function ExplainPrompt({
	selection,
	onSubmit,
	onCancel,
}: {
	selection: string;
	onSubmit: (question: string) => void;
	onCancel: () => void;
}) {
	const [question, setQuestion] = useState('');

	return (
		<form
			data-explain-prompt
			className="flex w-80 max-w-full flex-col gap-2 rounded-lg border border-violet-300 bg-violet-50 p-2.5 text-sm shadow-lg shadow-violet-900/10 dark:border-violet-800 dark:bg-violet-950"
			onSubmit={(event) => {
				event.preventDefault();

				if (question.trim()) onSubmit(question.trim());
			}}
			onKeyDown={(event) => {
				if (event.key === 'Escape') onCancel();
			}}
		>
			<blockquote className="line-clamp-2 border-l-2 border-violet-400 pl-2 text-xs text-violet-700 italic dark:text-violet-300">
				{selection}
			</blockquote>
			<div className="flex gap-2">
				<Input
					autoFocus
					value={question}
					onChange={(event) => setQuestion(event.target.value)}
					placeholder="Ask about this passage…"
					className="border-violet-300 bg-background focus-visible:border-violet-500 focus-visible:ring-violet-500/30 dark:border-violet-800"
				/>
				<Button
					type="submit"
					size="sm"
					disabled={!question.trim()}
					className="bg-violet-600 text-white hover:bg-violet-700"
				>
					Ask
				</Button>
			</div>
		</form>
	);
}

// One highlight, one question, one answer. The card owns a throwaway explain
// conversation: a fresh id is minted per card, the document and selection
// travel as `initialData` on the single send, and nothing contacts that
// conversation again after it settles.
export function ExplainCard({
	userId,
	input,
	question,
	onDismiss,
}: {
	userId: string;
	input: ExplainInput;
	question: string;
	onDismiss: () => void;
}) {
	// Explain ids follow the same `<userId>.<random>` shape the ownership
	// middleware checks; they are just never indexed.
	const agent = useFlueAgent({
		url: useMemo(() => `/agents/explain/${userId}.${crypto.randomUUID().replaceAll('-', '')}`, [userId]),
	});

	const busy = agent.status === 'submitted' || agent.status === 'streaming';

	const parts = agent.messages.filter((message) => message.role === 'assistant').flatMap((message) => message.parts);
	const answer = parts.map((part) => (part.type === 'text' ? part.text : '')).join('');
	// Tool parts stream in ahead of the answer: a running search shows its
	// query, and finished searches contribute their pages to the source list
	// under the answer (deduplicated by URL across calls).
	const searches = parts.flatMap((part) => (part.type === 'dynamic-tool' && part.toolName === 'search_web' ? [part] : []));
	// SAFETY: search_web's input schema is { query } (see src/agents/explain.ts);
	// dynamic-tool parts carry it untyped, and partial during streaming.
	const searching = searches.flatMap((part) => (part.state === 'output-available' ? [] : [(part.input as { query?: string } | undefined)?.query ?? '']));

	// SAFETY: search_web's run() returns the WebResult list (see
	// src/agents/explain.ts); only title and url are read here.
	const pages = searches.flatMap((part) => (part.state === 'output-available' ? (part.output as { title: string; url: string }[]) : []));

	const sources = [...new Map(pages.map((source) => [source.url, source] as const)).values()];

	// Send exactly once on mount. The ref guards StrictMode's double effect run.
	const sent = useRef(false);
	useEffect(() => {
		if (sent.current) return;
		sent.current = true;
		void agent.sendMessage(question, { initialData: input });
	}, []);

	return (
		<aside
			data-explain-ui
			// Nothing in the card may be nowrap: the chat scroll viewport sizes to its
			// content's min-content width, and one unwrappable line widens the column.
			className="not-prose my-3 flex w-full min-w-0 flex-col gap-2 rounded-lg border border-violet-200 bg-violet-50/70 p-3 text-sm dark:border-violet-900 dark:bg-violet-950/40"
		>
			<div className="flex items-start gap-2">
				<MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-violet-600 dark:text-violet-400" />
				<blockquote className="line-clamp-3 flex-1 border-l-2 border-violet-400 pl-2 text-violet-700 italic dark:text-violet-300">
					{input.selection}
				</blockquote>
				<Button
					variant="ghost"
					size="icon"
					className="size-6 shrink-0 text-violet-700 hover:bg-violet-100 dark:text-violet-300 dark:hover:bg-violet-900"
					aria-label="Dismiss"
					onClick={onDismiss}
				>
					<X className="size-3.5" />
				</Button>
			</div>
			<p className="font-medium">{question}</p>
			{searching.length > 0 && (
				<p className="flex items-center gap-1.5 text-xs text-violet-700 dark:text-violet-300">
					<Globe className="size-3.5 shrink-0" />
					<span className="break-words">Searching official sources: {searching.at(-1)}</span>
				</p>
			)}
			{busy && !answer && searching.length === 0 && <Loader2 className="size-4 animate-spin text-violet-500" />}
			{answer && <p className="leading-relaxed break-words whitespace-pre-wrap">{answer}</p>}
			{sources.length > 0 && (
				<ul className="flex flex-col gap-1 border-t border-violet-200 pt-2 text-xs dark:border-violet-900">
					{sources.map((source) => (
						<li key={source.url} className="flex min-w-0 items-start gap-1.5">
							<Globe className="mt-0.5 size-3.5 shrink-0 text-violet-500" />
							<a
								href={source.url}
								target="_blank"
								rel="noreferrer"
								className="inline text-violet-800 underline-offset-2 hover:underline dark:text-violet-200"
							>
								<span className="break-words">{source.title}</span>
								<ExternalLink className="ml-1 inline size-3 align-[-2px]" />
							</a>
						</li>
					))}
				</ul>
			)}
			{agent.status === 'error' && (
				<p className="text-destructive">Could not get an answer. Try again.</p>
			)}
		</aside>
	);
}
