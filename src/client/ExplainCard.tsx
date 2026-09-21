import { useFlueAgent } from '@flue/react';
import { Loader2, MessageCircleQuestion, X } from 'lucide-react';
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
			className="flex w-80 max-w-full flex-col gap-2 rounded-lg border bg-popover p-2.5 text-sm shadow-lg"
			onSubmit={(event) => {
				event.preventDefault();
				if (question.trim()) onSubmit(question.trim());
			}}
			onKeyDown={(event) => {
				if (event.key === 'Escape') onCancel();
			}}
		>
			<blockquote className="line-clamp-2 border-l-2 pl-2 text-xs text-muted-foreground italic">
				{selection}
			</blockquote>
			<div className="flex gap-2">
				<Input
					autoFocus
					value={question}
					onChange={(event) => setQuestion(event.target.value)}
					placeholder="Ask about this passage…"
				/>
				<Button type="submit" size="sm" disabled={!question.trim()}>
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
	input,
	question,
	onDismiss,
}: {
	input: ExplainInput;
	question: string;
	onDismiss: () => void;
}) {
	const agent = useFlueAgent({
		url: useMemo(() => `/agents/explain/${crypto.randomUUID()}`, []),
	});
	const busy = agent.status === 'submitted' || agent.status === 'streaming';
	const answer = agent.messages
		.filter((message) => message.role === 'assistant')
		.flatMap((message) => message.parts)
		.map((part) => (part.type === 'text' ? part.text : ''))
		.join('');

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
			className="not-prose my-3 flex flex-col gap-2 rounded-lg border bg-background p-3 text-sm"
		>
			<div className="flex items-start gap-2">
				<MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
				<blockquote className="line-clamp-3 flex-1 border-l-2 pl-2 text-muted-foreground italic">
					{input.selection}
				</blockquote>
				<Button
					variant="ghost"
					size="icon"
					className="size-6 shrink-0"
					aria-label="Dismiss"
					onClick={onDismiss}
				>
					<X className="size-3.5" />
				</Button>
			</div>
			<p className="font-medium">{question}</p>
			{busy && !answer && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
			{answer && <p className="leading-relaxed whitespace-pre-wrap">{answer}</p>}
			{agent.status === 'error' && (
				<p className="text-destructive">Could not get an answer. Try again.</p>
			)}
		</aside>
	);
}
