import type { useFlueAgent } from '@flue/react';
import { BookOpenText, Check, ChevronDown, ChevronUp, Highlighter, Loader2, Search, SendHorizontal, Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { AUTO_OPEN } from './documents.ts';
import { jurisdictionLabel, LevelBadge } from './LevelBadge.tsx';
import type { DocumentMatch } from './types.ts';
import { Welcome } from './Welcome.tsx';

export function ChatPanel({
	agent,
	openKeys,
	onOpenDocument,
	className,
}: {
	agent: ReturnType<typeof useFlueAgent>;
	// Keys of the documents currently open in the Resources panel.
	openKeys: string[];
	onOpenDocument: (match: DocumentMatch) => void;
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
		<section className={cn('flex min-h-0 min-w-0 flex-col', className)}>
			{/* Radix wraps the viewport's content in a display:table div sized to its
			    content, so a single nowrap line (a truncated search result) would widen
			    the whole column past the panel. Force that wrapper to block width. */}
			<ScrollArea className="min-h-0 flex-1 [&_[data-radix-scroll-area-viewport]>div]:!block">
				<div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-4 p-4" aria-live="polite">
					{visible.length === 0 && <Welcome onPrompt={send} disabled={busy} />}
					{visible.map((message) => (
						<article
							key={message.id}
							// Selecting text in a reply enables the explain shortcut (see SelectionExplain).
							data-explain-region={message.role === 'assistant' ? 'chat' : undefined}
							className={cn(
								'flex min-w-0 max-w-[85%] flex-col gap-2 rounded-xl px-3.5 py-2.5 text-sm',
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
									return <ToolCall key={index} part={part} openKeys={openKeys} onOpenDocument={onOpenDocument} />;
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
// the search query with its filters, the document being read, the number
// of passages being marked. Input streams in before output, so the line
// appears while the call is still running. A finished search also lists
// its results: the ones that opened on their own are always shown, and the
// rest fold away behind a toggle so a long result list does not swamp the
// reply. Any result opens on click.
function ToolCall({
	part,
	openKeys,
	onOpenDocument,
}: {
	part: ToolPart;
	openKeys: string[];
	onOpenDocument: (match: DocumentMatch) => void;
}) {
	const done = part.state === 'output-available';
	const detail = describe(part);
	const [expanded, setExpanded] = useState(false);
	// SAFETY: search_laws' run() in regulation.ts returns the DocumentMatch
	// list; dynamic-tool parts carry that output untyped.
	const matches = done && part.toolName === 'search_laws' ? (part.output as DocumentMatch[]) : [];
	const hidden = Math.max(0, matches.length - AUTO_OPEN);
	const shown = expanded ? matches : matches.slice(0, AUTO_OPEN);

	return (
		<div className="flex w-full min-w-0 flex-col gap-1.5 rounded-lg border bg-background/60 px-2.5 py-1.5 text-xs">
			<div className="flex min-w-0 items-start gap-2">
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
			{matches.length > 0 && (
				<div className="flex min-w-0 flex-col gap-0.5 border-t pt-1.5">
					<ol className="flex min-w-0 flex-col gap-0.5" aria-label="Search results">
						{shown.map((match) => (
							<li key={match.key} className="min-w-0">
								<SearchResult match={match} open={openKeys.includes(match.key)} onOpen={() => onOpenDocument(match)} />
							</li>
						))}
					</ol>
					{hidden > 0 && (
						<Button
							variant="ghost"
							size="sm"
							className="h-6 w-fit px-1.5 text-xs text-muted-foreground"
							aria-expanded={expanded}
							onClick={() => setExpanded((current) => !current)}
						>
							{expanded ? <ChevronUp data-icon="inline-start" /> : <ChevronDown data-icon="inline-start" />}
							{expanded ? 'Show fewer' : `Show ${hidden} more ${hidden === 1 ? 'document' : 'documents'}`}
						</Button>
					)}
				</div>
			)}
		</div>
	);
}

function SearchResult({ match, open, onOpen }: { match: DocumentMatch; open: boolean; onOpen: () => void }) {
	return (
		<button
			type="button"
			onClick={onOpen}
			title={open ? 'Show in Resources' : 'Open in Resources'}
			className="flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-muted"
		>
			<span className="w-3.5 shrink-0 text-muted-foreground">
				{open ? <Check className="size-3.5" aria-label="Open in Resources" /> : <BookOpenText className="size-3.5 opacity-50" />}
			</span>
			<span className="min-w-0 flex-1 truncate">
				<span className="font-medium">{match.title}</span>
				{match.citation && <span className="text-muted-foreground"> · {match.citation}</span>}
			</span>
			<span className="shrink-0">
				<LevelBadge level={match.level} size="sm" />
			</span>
		</button>
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

	if (part.toolName === 'read_law') {
		// SAFETY: read_law's input schema is { key, find?, offset? } and its run()
		// returns the document's title and a window of it, or { error }.
		const input = part.input as { key?: string; find?: string; offset?: number } | undefined;
		// SAFETY: see above; both shapes are covered by these optional fields.
		const output = done ? (part.output as { title?: string; matches?: number; error?: string }) : null;

		return {
			Icon: BookOpenText,
			label: output === null ? 'Reading document' : output.title ? `Read ${output.title}` : 'Could not read document',
			level: '',
			chips: input?.find ? [output?.matches === undefined ? 'searching text' : `${plural(output.matches, 'match')} in text`] : [],
			body: input?.find ?? (output?.title ? '' : (input?.key ?? '')),
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
