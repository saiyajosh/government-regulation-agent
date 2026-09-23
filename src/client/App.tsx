import { useFlueAgent } from '@flue/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { History, SquarePen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ChatPanel } from './ChatPanel.tsx';
import { ConversationsDrawer } from './ConversationsDrawer.tsx';
import { useConversations } from './conversations.ts';
import { useOpenDocuments } from './documents.ts';
import { ResourcesPanel } from './ResourcesPanel.tsx';
import { SelectionExplain } from './SelectionExplain.tsx';
import type { Passage } from './highlights.ts';
import type { DocumentMatch, DocumentRecord } from './types.ts';

export function App() {
	const history = useConversations();

	// Dormant until the server has told us which conversation is ours.
	const agent = useFlueAgent({
		url: history.currentId ? `/agents/regulation-agent/${history.currentId}` : undefined,
	});

	const [drawerOpen, setDrawerOpen] = useState(false);

	// When a reply settles, report its opening text as the list-view snippet.
	const previousStatus = useRef(agent.status);
	useEffect(() => {
		const settled = previousStatus.current === 'streaming' && agent.status === 'idle';
		previousStatus.current = agent.status;

		if (!settled || !history.currentId) return;
		const reply = agent.messages.findLast((message) => message.role === 'assistant');
		const text = reply?.parts.map((part) => (part.type === 'text' ? part.text : '')).join(' ') ?? '';

		if (text.trim()) void history.reportSnippet(history.currentId, text);
	}, [agent.status, agent.messages, history]);

	// Documents enter the Resources panel from search results (see documents.ts);
	// there is no browsable library, so the panel is hidden until the first search.
	const resources = useOpenDocuments(history.currentId, agent.messages);

	// Passages to highlight, per document key, gathered from the same tool
	// parts: search_laws excerpts are "retrieved", and quotes the agent names
	// in highlight_passages are "cited". Replayed messages carry their tool
	// parts too, so a reopened conversation keeps its highlights.
	const passages = useMemo(() => {
		const byKey: Record<string, Passage[]> = {};

		const add = (key: string, kind: Passage['kind'], texts: string[]) => {
			byKey[key] = [...(byKey[key] ?? []), ...texts.map((text) => ({ text, kind }))];
		};

		for (const message of agent.messages) {
			for (const part of message.parts) {
				if (part.type !== 'dynamic-tool' || part.state !== 'output-available') continue;

				if (part.toolName === 'search_laws') {
					// SAFETY: search_laws' run() in regulation.ts returns the DocumentMatch
					// list; dynamic-tool parts carry that output untyped.
					const matches = part.output as DocumentMatch[];

					for (const match of matches) add(match.key, 'retrieved', match.excerpts.map((e) => e.text));
				}

				if (part.toolName === 'highlight_passages') {
					// SAFETY: highlight_passages' input schema in regulation.ts is
					// { key, passages }; dynamic-tool parts carry the input untyped.
					const input = part.input as { key: string; passages: string[] };

					if (input.passages.length) add(input.key, 'cited', input.passages);
				}
			}
		}

		return byKey;
	}, [agent.messages]);

	const showResources = resources.docs.length > 0;
	// The explain shortcut quotes from a document's text, so only loaded tabs count.
	const readyDocs = resources.docs.filter((doc): doc is DocumentRecord & { status: 'ready' } => doc.status === 'ready');

	return (
		<div className="flex h-dvh flex-col bg-background text-foreground">
			<header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
				<Button
					variant="ghost"
					size="icon"
					className="size-7"
					aria-label="Conversation history"
					onClick={() => setDrawerOpen(true)}
				>
					<History className="size-4" />
				</Button>
				<span aria-hidden className="text-base leading-none">
					🌱
				</span>
				<h1 className="flex-1 font-heading text-sm font-semibold tracking-tight">
					Greenhouse Guide
				</h1>
				<Button variant="ghost" size="sm" onClick={() => void history.create()}>
					<SquarePen data-icon="inline-start" />
					New chat
				</Button>
			</header>
			<ConversationsDrawer
				open={drawerOpen}
				conversations={history.conversations}
				currentId={history.currentId}
				onSelect={(id) => {
					history.select(id);
					setDrawerOpen(false);
				}}
				onNew={() => {
					void history.create();
					setDrawerOpen(false);
				}}
				onClose={() => setDrawerOpen(false)}
			/>
			<main
				className={cn(
					'grid min-h-0 flex-1 grid-cols-1',
					showResources && 'md:grid-cols-[minmax(320px,1fr)_minmax(400px,1.4fr)]',
				)}
			>
				{history.status === 'error' ? (
					<div className="flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
						<p>Couldn&apos;t load your conversations. {history.error}</p>
						<Button variant="outline" size="sm" onClick={() => void history.retry()}>
							Retry
						</Button>
					</div>
				) : (
					<ChatPanel
						key={history.currentId}
						agent={agent}
						openKeys={resources.docs.map((doc) => doc.key)}
						onOpenDocument={(match) => resources.open([match])}
						className={showResources ? 'border-b md:border-r md:border-b-0' : undefined}
					/>
				)}
				{showResources && (
					<ResourcesPanel
						openDocs={resources.docs}
						passages={passages}
						activeKey={resources.activeKey ?? resources.docs[0].key}
						onSelect={resources.select}
						onClose={resources.close}
						onRetry={resources.retry}
					/>
				)}
			</main>
			<SelectionExplain
				userId={history.userId}
				openDocs={readyDocs}
				chatStarted={agent.messages.length > 0}
			/>
		</div>
	);
}
