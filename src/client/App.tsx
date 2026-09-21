import { useFlueAgent } from '@flue/react';
import { useEffect, useMemo, useState } from 'react';
import { Landmark } from 'lucide-react';
import { ChatPanel } from './ChatPanel.tsx';
import { ResourcesPanel } from './ResourcesPanel.tsx';
import type { DocumentRecord } from './types.ts';

const CONVERSATION_STORAGE_KEY = 'gra:conversation-id';

function getConversationId() {
	try {
		const existing = sessionStorage.getItem(CONVERSATION_STORAGE_KEY);
		if (existing) return existing;
		const id = crypto.randomUUID();
		sessionStorage.setItem(CONVERSATION_STORAGE_KEY, id);
		return id;
	} catch {
		return crypto.randomUUID();
	}
}

export function App() {
	const conversationId = useMemo(getConversationId, []);
	const agent = useFlueAgent({ url: `/agents/regulation-agent/${conversationId}` });

	const [openDocs, setOpenDocs] = useState<DocumentRecord[]>([]);
	// `null` means the Library tab is active.
	const [activeKey, setActiveKey] = useState<string | null>(null);

	const openByKey = useMemo(() => {
		return async (key: string) => {
			const res = await fetch(`/api/documents/${encodeURIComponent(key)}`);
			if (!res.ok) return;
			const doc = (await res.json()) as DocumentRecord;
			setOpenDocs((docs) => (docs.some((d) => d.key === doc.key) ? docs : [...docs, doc]));
			setActiveKey(doc.key);
		};
	}, []);

	// When the agent's open_law tool fires, it streams a named `openDocument`
	// data part (see useDataWriter in the agent). The tool's own output also
	// carries the full document, so we can open the tab without a second fetch.
	useEffect(() => {
		for (const message of agent.messages) {
			for (const part of message.parts) {
				if (part.type !== 'dynamic-tool') continue;
				if (part.toolName !== 'open_law' || part.state !== 'output-available') continue;
				const output = part.output as DocumentRecord | { error: string };
				if ('error' in output) continue;
				setOpenDocs((docs) => (docs.some((d) => d.key === output.key) ? docs : [...docs, output]));
				setActiveKey(output.key);
			}
		}
	}, [agent.messages]);

	return (
		<div className="flex h-dvh flex-col bg-background text-foreground">
			<header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
				<Landmark className="size-4 text-muted-foreground" />
				<h1 className="font-heading text-sm font-semibold tracking-tight">
					Government Regulation Agent
				</h1>
			</header>
			<main className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(320px,1fr)_minmax(400px,1.4fr)]">
				<ChatPanel agent={agent} />
				<ResourcesPanel
					openDocs={openDocs}
					activeKey={activeKey}
					onSelect={setActiveKey}
					onOpen={openByKey}
					onClose={(key) =>
						setOpenDocs((docs) => {
							const next = docs.filter((doc) => doc.key !== key);
							if (activeKey === key) setActiveKey(next.at(-1)?.key ?? null);
							return next;
						})
					}
				/>
			</main>
		</div>
	);
}
