import type { useFlueAgent } from '@flue/react';
import { Loader2, SendHorizontal, Wrench } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
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
				<div className="mx-auto flex w-full max-w-3xl items-end gap-2">
				<Textarea
					value={input}
					onChange={(event) => setInput(event.target.value)}
					onKeyDown={(event) => {
						if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
						event.preventDefault();
						void submit();
					}}
					placeholder="Ask about a law or regulation…"
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
