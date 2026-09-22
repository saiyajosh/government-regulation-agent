import { useFlueAgent } from '@flue/react';
import { useEffect, useRef, useState } from 'react';
import { History, Landmark, SquarePen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ChatPanel } from './ChatPanel.tsx';
import { ConversationsDrawer } from './ConversationsDrawer.tsx';
import { useConversations } from './conversations.ts';
import { ResourcesPanel } from './ResourcesPanel.tsx';
import { SelectionExplain } from './SelectionExplain.tsx';
import type { DocumentRecord } from './types.ts';

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

	// Documents only enter the Resources panel when the agent opens them; there
	// is no browsable library, so the panel is hidden until the first open_law.
	const [openDocs, setOpenDocs] = useState<DocumentRecord[]>([]);
	const [activeKey, setActiveKey] = useState<string | null>(null);
	// Each open_law call is applied exactly once. `agent.messages` changes on
	// every stream chunk and keeps the full history, so without this a tab the
	// user closed would reopen (and steal focus) on the next message.
	const appliedOpenLawCalls = useRef(new Set<string>());
	// Switching conversations starts from a clean Resources panel; the applied
	// set is cleared too so re-entering a conversation reopens its documents.
	useEffect(() => {
		appliedOpenLawCalls.current.clear();
		setOpenDocs([]);
		setActiveKey(null);
	}, [history.currentId]);

	// When the agent's open_law tool fires, it streams a named `openDocument`
	// data part (see useDataWriter in the agent). The tool's own output also
	// carries the full document, so we can open the tab without a second fetch.
	useEffect(() => {
		for (const message of agent.messages) {
			for (const part of message.parts) {
				if (part.type !== 'dynamic-tool') continue;

				if (part.toolName !== 'open_law' || part.state !== 'output-available') continue;

				if (appliedOpenLawCalls.current.has(part.toolCallId)) continue;
				appliedOpenLawCalls.current.add(part.toolCallId);
				// SAFETY: open_law's run() in regulation-agent.ts returns either the
				// DocumentRecord it loaded or `{ error }`; dynamic-tool parts carry that
				// output untyped.
				const output = part.output as DocumentRecord | { error: string };

				if ('error' in output) continue;
				setOpenDocs((docs) => (docs.some((d) => d.key === output.key) ? docs : [...docs, output]));
				setActiveKey(output.key);
			}
		}
	}, [agent.messages]);

	const showResources = openDocs.length > 0;

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
				<Landmark className="size-4 text-muted-foreground" />
				<h1 className="flex-1 font-heading text-sm font-semibold tracking-tight">
					Government Regulation Agent
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
				<ChatPanel
					key={history.currentId}
					agent={agent}
					className={showResources ? 'border-b md:border-r md:border-b-0' : undefined}
				/>
				{showResources && (
					<ResourcesPanel
						openDocs={openDocs}
						activeKey={activeKey ?? openDocs[0].key}
						onSelect={setActiveKey}
						onClose={(key) =>
							setOpenDocs((docs) => {
								const next = docs.filter((doc) => doc.key !== key);

								if (activeKey === key) setActiveKey(next.at(-1)?.key ?? null);

								return next;
							})
						}
					/>
				)}
			</main>
			<SelectionExplain
				userId={history.userId}
				openDocs={openDocs}
				chatStarted={agent.messages.length > 0}
			/>
		</div>
	);
}
