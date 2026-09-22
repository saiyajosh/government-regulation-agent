import { MessageSquare, SquarePen, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { ConversationSummary } from './conversations.ts';

// Past conversations for this browser's identity, newest activity first.
export function ConversationsDrawer({
	open,
	conversations,
	currentId,
	onSelect,
	onNew,
	onClose,
}: {
	open: boolean;
	conversations: ConversationSummary[];
	currentId: string | null;
	onSelect: (id: string) => void;
	onNew: () => void;
	onClose: () => void;
}) {
	if (!open) return null;

	return (
		<>
			<button
				type="button"
				aria-label="Close history"
				className="fixed inset-0 z-40 bg-black/20 animate-in fade-in duration-200"
				onClick={onClose}
			/>
			<aside className="fixed inset-y-0 left-0 z-50 flex w-80 max-w-[85vw] flex-col border-r bg-background shadow-xl animate-in slide-in-from-left duration-200">
				<div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
					<h2 className="flex-1 text-sm font-semibold">History</h2>
					<Button variant="ghost" size="sm" onClick={onNew}>
						<SquarePen data-icon="inline-start" />
						New chat
					</Button>
					<Button variant="ghost" size="icon" className="size-7" aria-label="Close" onClick={onClose}>
						<X className="size-4" />
					</Button>
				</div>
				<ScrollArea className="min-h-0 flex-1">
					<ul className="flex flex-col gap-1 p-2">
						{conversations.length === 0 && (
							<li className="px-2 py-6 text-center text-xs text-muted-foreground">No conversations yet.</li>
						)}
						{conversations.map((conversation) => (
							<li key={conversation.id}>
								<button
									type="button"
									onClick={() => onSelect(conversation.id)}
									className={cn(
										'flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent',
										conversation.id === currentId && 'bg-accent',
									)}
								>
									<span className="flex items-center gap-2">
										<MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
										<span className="truncate text-sm font-medium">{conversation.title}</span>
									</span>
									{conversation.snippet && (
										<span className="line-clamp-2 pl-5.5 text-xs leading-relaxed text-muted-foreground">
											{conversation.snippet}
										</span>
									)}
									<span className="pl-5.5 text-[11px] text-muted-foreground/70">
										{relativeTime(conversation.updatedAt)}
									</span>
								</button>
							</li>
						))}
					</ul>
				</ScrollArea>
			</aside>
		</>
	);
}

function relativeTime(iso: string) {
	const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);

	if (seconds < 60) return 'just now';
	const minutes = Math.round(seconds / 60);

	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.round(minutes / 60);

	if (hours < 24) return `${hours} hr ago`;
	const days = Math.round(hours / 24);

	if (days < 7) return `${days} d ago`;

	return new Date(iso).toLocaleDateString();
}
