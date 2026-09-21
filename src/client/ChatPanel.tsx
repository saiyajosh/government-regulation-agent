import type { useFlueAgent } from '@flue/react';
import { Loader2, MessageSquareText, SendHorizontal, Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from '@/components/ui/empty';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

// What the library holds. Each scope maps onto the level/jurisdiction
// metadata the agent's search_laws tool can filter on; the chosen scope is
// sent as a `[Scope: …]` prefix the agent's prompt knows how to read.
const SCOPES = [
	{
		id: 'all',
		label: 'All jurisdictions',
		hint: 'Greenhouse gas rules at every level',
		examples: ['Which greenhouse gas rules apply to a new natural gas power plant in Oakland?'],
	},
	{
		id: 'federal',
		label: 'Federal',
		hint: 'EPA, DOE, NHTSA rules and the Clean Air Act',
		examples: [
			'Which facilities must report under the Greenhouse Gas Reporting Program?',
			'What methane limits apply to existing oil and gas wells?',
		],
	},
	{
		id: 'california',
		label: 'California',
		hint: 'AB 32, cap-and-trade, LCFS, vehicle mandates',
		examples: [
			'What does AB 32 require the Air Resources Board to do?',
			'Who must hold compliance instruments under cap-and-trade?',
		],
	},
	{
		id: 'bayarea',
		label: 'Bay Area',
		hint: 'BAAQMD rules and Oakland, San Jose, and SF codes',
		examples: [
			'What does BAAQMD require after a significant methane release?',
			'Does San Jose prohibit natural gas in new buildings?',
		],
	},
] as const;

type ScopeId = (typeof SCOPES)[number]['id'];

export function ChatPanel({
	agent,
	className,
}: {
	agent: ReturnType<typeof useFlueAgent>;
	className?: string;
}) {
	const [input, setInput] = useState('');
	const [scopeId, setScopeId] = useState<ScopeId>('all');
	const scope = SCOPES.find((s) => s.id === scopeId) ?? SCOPES[0];
	const bottomRef = useRef<HTMLDivElement>(null);
	const busy = agent.status === 'submitted' || agent.status === 'streaming';

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ block: 'end' });
	}, [agent.messages]);

	async function submit(event?: React.FormEvent) {
		event?.preventDefault();
		const message = input.trim();
		if (!message || busy) return;
		setInput('');
		await agent.sendMessage(scope.id === 'all' ? message : `[Scope: ${scope.label}] ${message}`);
	}

	const visible = agent.messages.filter((message) => message.display === 'visible');

	return (
		<section className={cn('flex min-h-0 flex-col', className)}>
			<ScrollArea className="min-h-0 flex-1">
				<div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4" aria-live="polite">
					{visible.length === 0 && (
						<Empty className="mt-16 border-0">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<MessageSquareText />
								</EmptyMedia>
								<EmptyTitle>Ask about greenhouse gas regulation</EmptyTitle>
								<EmptyDescription>
									Federal, California, and Bay Area rules, grounded in the official text.
									Pick a scope below or try one of these:
								</EmptyDescription>
							</EmptyHeader>
							<div className="flex flex-col items-center gap-1.5">
								{SCOPES.flatMap((s) => s.examples.map((example) => (
									<Button
										key={example}
										variant="ghost"
										size="sm"
										className="h-auto whitespace-normal text-muted-foreground"
										onClick={() => {
											setScopeId(s.id);
											setInput(example);
										}}
									>
										{example}
									</Button>
								)))}
							</div>
						</Empty>
					)}
					{visible.map((message) => (
						<article
							key={message.id}
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
									const done = part.state === 'output-available';
									return (
										<Badge key={index} variant="outline" className="w-fit gap-1.5 font-mono">
											{done ? <Wrench /> : <Loader2 className="animate-spin" />}
											{part.toolName}
										</Badge>
									);
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
				<div
					className="mx-auto mb-2 flex w-full max-w-3xl flex-wrap items-center gap-1.5"
					role="radiogroup"
					aria-label="Jurisdiction scope"
				>
					{SCOPES.map((s) => (
						<Button
							key={s.id}
							type="button"
							role="radio"
							aria-checked={s.id === scopeId}
							variant={s.id === scopeId ? 'default' : 'outline'}
							size="sm"
							title={s.hint}
							onClick={() => setScopeId(s.id)}
						>
							{s.label}
						</Button>
					))}
					<span className="ml-1 text-xs text-muted-foreground">{scope.hint}</span>
				</div>
				<div className="mx-auto flex w-full max-w-3xl items-end gap-2">
				<Textarea
					value={input}
					onChange={(event) => setInput(event.target.value)}
					onKeyDown={(event) => {
						if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
						event.preventDefault();
						void submit();
					}}
					placeholder={`Ask about greenhouse gas rules (${scope.label.toLowerCase()})…`}
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
