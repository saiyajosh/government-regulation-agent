import type { useFlueAgent } from '@flue/react';
import { BookOpenText, Highlighter, Loader2, Search, SendHorizontal, Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { jurisdictionLabel, LevelBadge } from './LevelBadge.tsx';
import { Welcome } from './Welcome.tsx';

export function ChatPanel({
	agent,
	className,
}: {
	agent: ReturnType<typeof useFlueAgent>;
	className?: string;
}) {
	const [input, setInput] = useState('');
	const bottomRef = useRef<HTMLDivElement>(null);
	const busy = agent.status === 'submitted' || agent.status === 'streaming';

	// Skip on the empty state so the welcome screen isn't scrolled off the top.
	useEffect(() => {
		if (agent.messages.length === 0) return;
		bottomRef.current?.scrollIntoView({ block: 'end' });
	}, [agent.messages]);

	async function send(text: string) {
		const message = text.trim();

		if (!message || busy) return;
		setInput('');
		await agent.sendMessage(message);
	}

	function submit(event?: React.FormEvent) {
		event?.preventDefault();
		void send(input);
	}

	const visible = agent.messages.filter((message) => message.display === 'visible');

	return (
		<section className={cn('flex min-h-0 flex-col', className)}>
			<ScrollArea className="min-h-0 flex-1">
				<div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4" aria-live="polite">
					{visible.length === 0 && <Welcome onPrompt={send} disabled={busy} />}
					{visible.map((message) => (
						<article
							key={message.id}
							// Selecting text in a reply enables the explain shortcut (see SelectionExplain).
							data-explain-region={message.role === 'assistant' ? 'chat' : undefined}
							className={cn(
								'flex max-w-[85%] flex-col gap-2 rounded-xl px-3.5 py-2.5 text-sm',
								message.role === 'user'
									? 'self-end bg-primary text-primary-foreground'
									: 'self-start bg-muted',
							)}
						>
							{message.parts.map((part, index) => {
								if (part.type === 'text') {
									return (
										<p key={index} className="whitespace-pre-wrap leading-relaxed">
											{part.text}
										</p>
									);
								}

								if (part.type === 'dynamic-tool') {
									return <ToolCall key={index} part={part} />;
								}

								return null;
							})}
						</article>
					))}
					{agent.status === 'error' && agent.error && (
						<p className="text-sm text-destructive">{agent.error.message}</p>
					)}
					<div ref={bottomRef} />
				</div>
			</ScrollArea>

			<form onSubmit={submit} className="border-t p-3">
				<div className="mx-auto flex w-full max-w-3xl items-end gap-2">
				<Textarea
					value={input}
					onChange={(event) => setInput(event.target.value)}
					onKeyDown={(event) => {
						if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
						event.preventDefault();
						void submit();
					}}
					placeholder="Ask about emissions rules at the federal, California, or Bay Area level…"
					rows={1}
					className="max-h-40 min-h-9 resize-none"
				/>
				<Button
					type="submit"
					size="icon"
					disabled={!input.trim() || busy}
					aria-label="Send"
				>
					{busy ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
				</Button>
				</div>
			</form>
		</section>
	);
}

type ToolPart = Extract<
	ReturnType<typeof useFlueAgent>['messages'][number]['parts'][number],
	{ type: 'dynamic-tool' }
>;

// A tool call reads as what the agent is doing, not which function it hit:
// the search query with its filters, the document being opened, the number
// of passages being marked. Input streams in before output, so the line
// appears while the call is still running.
function ToolCall({ part }: { part: ToolPart }) {
	const done = part.state === 'output-available';
	const input = (part.input ?? {}) as Record<string, unknown>;
	const output = done ? (part.output as Record<string, unknown> | unknown[]) : null;
	const detail = describe(part.toolName, input, output);
	return (
		<div className="flex w-fit max-w-full items-start gap-2 rounded-lg border bg-background/60 px-2.5 py-1.5 text-xs">
			<span className="mt-0.5 shrink-0 text-muted-foreground">
				{!done ? <Loader2 className="size-3.5 animate-spin" /> : <detail.Icon className="size-3.5" />}
			</span>
			<div className="flex min-w-0 flex-col gap-0.5">
				<span className="flex flex-wrap items-center gap-1.5">
					<span className="font-medium">{detail.label}</span>
					{detail.level && <LevelBadge level={detail.level} size="sm" />}
					{detail.chips.map((chip) => (
						<Badge key={chip} variant="secondary" className="h-4 px-1.5 text-[10px]">
							{chip}
						</Badge>
					))}
				</span>
				{detail.body && <span className="line-clamp-2 text-muted-foreground">{detail.body}</span>}
			</div>
		</div>
	);
}

function describe(name: string, input: Record<string, unknown>, output: Record<string, unknown> | unknown[] | null) {
	const str = (value: unknown) => (typeof value === 'string' ? value : '');
	if (name === 'search_laws') {
		const count = Array.isArray(output) ? output.length : null;
		return {
			Icon: Search,
			label: output === null ? 'Searching the library' : count === 0 ? 'No matching documents' : `Found ${count} document${count === 1 ? '' : 's'}`,
			level: str(input.level),
			chips: [jurisdictionLabel(str(input.level), str(input.jurisdiction))].filter((chip) => chip !== null),
			body: str(input.query),
		};
	}
	if (name === 'open_law') {
		const title = output && !Array.isArray(output) ? str(output.title) : '';
		const passages = Array.isArray(input.passages) ? input.passages.length : 0;
		return {
			Icon: BookOpenText,
			label: output === null ? 'Opening document' : title ? `Opened ${title}` : 'Could not open document',
			level: output && !Array.isArray(output) ? str(output.level) : '',
			chips: passages > 0 ? [`${passages} passage${passages === 1 ? '' : 's'} marked`] : [],
			body: title ? '' : str(input.key),
		};
	}
	if (name === 'highlight_passages') {
		const passages = Array.isArray(input.passages) ? (input.passages as unknown[]) : [];
		return {
			Icon: Highlighter,
			label: `Marking ${passages.length} passage${passages.length === 1 ? '' : 's'}`,
			level: '',
			chips: [],
			body: str(passages[0]),
		};
	}
	return { Icon: Wrench, label: name, level: '', chips: [], body: '' };
}
