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

export function ChatPanel({ agent }: { agent: ReturnType<typeof useFlueAgent> }) {
	const [input, setInput] = useState('');
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
		await agent.sendMessage(message);
	}

	const visible = agent.messages.filter((message) => message.display === 'visible');

	return (
		<section className="flex min-h-0 flex-col border-b md:border-r md:border-b-0">
			<ScrollArea className="min-h-0 flex-1">
				<div className="flex flex-col gap-4 p-4" aria-live="polite">
					{visible.length === 0 && (
						<Empty className="mt-16 border-0">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<MessageSquareText />
								</EmptyMedia>
								<EmptyTitle>Ask about a law or regulation</EmptyTitle>
								<EmptyDescription>
									Federal, state, county, or municipal — e.g. “What does the Administrative
									Procedure Act require of agencies?”
								</EmptyDescription>
							</EmptyHeader>
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

			<form onSubmit={submit} className="flex items-end gap-2 border-t p-3">
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
			</form>
		</section>
	);
}
