import { useFlueAgent } from '@flue/react';
import { Loader2, MessageCircleQuestion, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { DocumentRecord } from './types.ts';

// One highlight, one question, one answer. The card owns a throwaway explain
// conversation: a fresh id is minted per card, the document and selection
// travel as `initialData` on the single send, and nothing contacts that
// conversation again after it settles.
export function ExplainCard({
	doc,
	selection,
	context,
	onDismiss,
}: {
	doc: DocumentRecord;
	selection: string;
	context: string;
	onDismiss: () => void;
}) {
	const agent = useFlueAgent({
		url: useMemo(() => `/agents/explain/${crypto.randomUUID()}`, []),
	});
	const [question, setQuestion] = useState('');
	const asked = agent.messages.some((message) => message.role === 'user');
	const busy = agent.status === 'submitted' || agent.status === 'streaming';
	const answer = agent.messages
		.filter((message) => message.role === 'assistant')
		.flatMap((message) => message.parts)
		.map((part) => (part.type === 'text' ? part.text : ''))
		.join('');

	function submit(event: React.FormEvent) {
		event.preventDefault();
		const trimmed = question.trim();
		if (!trimmed || asked) return;
		void agent.sendMessage(trimmed, {
			initialData: {
				key: doc.key,
				title: doc.title,
				jurisdiction: doc.jurisdiction,
				citation: doc.citation,
				body: doc.body,
				selection,
				context,
			},
		});
	}

	return (
		<aside className="not-prose my-3 flex flex-col gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
			<div className="flex items-start gap-2">
				<MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
				<blockquote className="line-clamp-3 flex-1 border-l-2 pl-2 text-muted-foreground italic">
					{selection}
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
			{!asked && (
				<form onSubmit={submit} className="flex gap-2">
					<Input
						autoFocus
						value={question}
						onChange={(event) => setQuestion(event.target.value)}
						placeholder="Ask about this passage…"
					/>
					<Button type="submit" size="sm" disabled={!question.trim()}>
						Ask
					</Button>
				</form>
			)}
			{asked && (
				<p className="font-medium">
					{agent.messages.find((message) => message.role === 'user')?.parts.map((part) =>
						part.type === 'text' ? part.text : '',
					)}
				</p>
			)}
			{busy && !answer && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
			{answer && <p className="leading-relaxed whitespace-pre-wrap">{answer}</p>}
			{agent.status === 'error' && (
				<p className="text-destructive">Could not get an answer. Try again.</p>
			)}
		</aside>
	);
}
