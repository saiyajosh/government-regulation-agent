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
	const detail = describe(part);

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

// Dynamic-tool parts carry input and output untyped; each branch narrows
// them to the schema the matching tool declares in regulation-agent.ts.
function describe(part: ToolPart) {
	const done = part.state === 'output-available';
	const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

	if (part.toolName === 'search_laws') {
		// SAFETY: search_laws' input schema is { query, level?, jurisdiction? } and
		// its run() returns the DocumentMatch list.
		const input = part.input as { query?: string; level?: string; jurisdiction?: string } | undefined;
		// SAFETY: see above; only the list length is read here.
		const count = done ? (part.output as unknown[]).length : null;

		return {
			Icon: Search,
			label: count === null ? 'Searching the library' : count === 0 ? 'No matching documents' : `Found ${plural(count, 'document')}`,
			level: input?.level ?? '',
			chips: [jurisdictionLabel(input?.level ?? '', input?.jurisdiction ?? '')].filter((chip) => chip !== null),
			body: input?.query ?? '',
		};
	}

	if (part.toolName === 'open_law') {
		// SAFETY: open_law's input schema is { key, passages? } and its run()
		// returns either the DocumentRecord it loaded or { error }.
		const input = part.input as { key?: string; passages?: string[] } | undefined;
		// SAFETY: see above; both shapes are covered by these optional fields.
		const output = done ? (part.output as { title?: string; level?: string; error?: string }) : null;
		const passages = input?.passages?.length ?? 0;

		return {
			Icon: BookOpenText,
			label: output === null ? 'Opening document' : output.title ? `Opened ${output.title}` : 'Could not open document',
			level: output?.level ?? '',
			chips: passages > 0 ? [`${plural(passages, 'passage')} marked`] : [],
			body: output?.title ? '' : (input?.key ?? ''),
		};
	}

	if (part.toolName === 'highlight_passages') {
		// SAFETY: highlight_passages' input schema is { key, passages }.
		const input = part.input as { passages?: string[] } | undefined;
		const passages = input?.passages ?? [];

		return {
			Icon: Highlighter,
			label: `Marking ${plural(passages.length, 'passage')}`,
			level: '',
			chips: [],
			body: passages[0] ?? '',
		};
	}

	return { Icon: Wrench, label: part.toolName, level: '', chips: [], body: '' };
}
