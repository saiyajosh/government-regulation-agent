import { ExternalLink, MessageCircleQuestion, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ExplainCard } from './ExplainCard.tsx';
import { useCompiledMdx } from './mdx.tsx';
import type { DocumentRecord } from './types.ts';

// One tab per document the agent has opened via open_law. The panel has no
// browsable library on purpose: the bucket will hold far too many laws to
// enumerate, so documents appear only when the agent surfaces them.
export function ResourcesPanel({
	openDocs,
	activeKey,
	onSelect,
	onClose,
}: {
	openDocs: DocumentRecord[];
	activeKey: string;
	onSelect: (key: string) => void;
	onClose: (key: string) => void;
}) {
	return (
		<Tabs value={activeKey} onValueChange={onSelect} className="min-h-0 gap-0">
			<div className="shrink-0 overflow-x-auto border-b">
				<TabsList variant="line" className="h-10 w-full justify-start px-2">
					{openDocs.map((doc) => (
						<TabsTrigger key={doc.key} value={doc.key} className="flex-none max-w-64 pr-0.5">
							<span className="truncate">{doc.title}</span>
							{/* A button inside a button is invalid HTML, so the close affordance is a span. */}
							<span
								role="button"
								tabIndex={0}
								aria-label={`Close ${doc.title}`}
								className="ml-0.5 inline-flex size-5 items-center justify-center rounded-sm opacity-60 hover:bg-muted hover:opacity-100"
								onClick={(event) => {
									event.stopPropagation();
									onClose(doc.key);
								}}
								onKeyDown={(event) => {
									if (event.key !== 'Enter' && event.key !== ' ') return;
									event.preventDefault();
									event.stopPropagation();
									onClose(doc.key);
								}}
							>
								<X className="size-3.5" />
							</span>
						</TabsTrigger>
					))}
				</TabsList>
			</div>

			{openDocs.map((doc) => (
				<TabsContent key={doc.key} value={doc.key} className="min-h-0">
					<ScrollArea className="h-full">
						<DocumentView doc={doc} />
					</ScrollArea>
				</TabsContent>
			))}
		</Tabs>
	);
}

function DocumentView({ doc }: { doc: DocumentRecord }) {
	const { Content, error } = useCompiledMdx(doc.body);
	const articleRef = useRef<HTMLElement>(null);
	const proseRef = useRef<HTMLDivElement>(null);

	// A non-empty selection inside the prose: the text, the top-level block it
	// ends in, and where to float the "Ask" button (relative to the article).
	const [pending, setPending] = useState<{
		text: string;
		block: HTMLElement;
		top: number;
		left: number;
	} | null>(null);

	// Each card is portaled into a host <div> inserted directly after the block
	// the selection ended in. The MDX tree is React-owned, so we never mutate
	// it; the host lives beside a block, not inside one.
	const [cards, setCards] = useState<
		{ id: string; selection: string; context: string; host: HTMLDivElement }[]
	>([]);

	useEffect(() => {
		function onSelectionChange() {
			const selection = window.getSelection();
			const prose = proseRef.current;
			const article = articleRef.current;
			if (!selection || !prose || !article || selection.isCollapsed) return setPending(null);
			const range = selection.getRangeAt(0);
			if (!prose.contains(range.commonAncestorContainer)) return setPending(null);
			const text = selection.toString().trim();
			if (!text) return setPending(null);
			const block = topLevelBlock(range.endContainer, prose);
			if (!block) return setPending(null);
			const rect = range.getBoundingClientRect();
			const articleRect = article.getBoundingClientRect();
			setPending({
				text,
				block,
				top: rect.bottom - articleRect.top + 6,
				left: Math.max(0, rect.left - articleRect.left),
			});
		}
		document.addEventListener('selectionchange', onSelectionChange);
		return () => document.removeEventListener('selectionchange', onSelectionChange);
	}, []);

	function askAboutSelection() {
		if (!pending) return;
		const host = document.createElement('div');
		// Not `.after()`: workers-types' HTMLRewriter `Element` shadows the DOM signature.
		pending.block.insertAdjacentElement('afterend', host);
		setCards((all) => [
			...all,
			{
				id: crypto.randomUUID(),
				selection: pending.text,
				context: pending.block.textContent?.trim() ?? '',
				host,
			},
		]);
		window.getSelection()?.removeAllRanges();
		setPending(null);
	}

	return (
		<article ref={articleRef} className="relative mx-auto max-w-3xl p-6">
			<header className="flex flex-col gap-3">
				<h2 className="font-heading text-2xl font-semibold tracking-tight">{doc.title}</h2>
				<div className="flex flex-wrap items-center gap-1.5">
					<Badge variant="secondary">{doc.jurisdiction}</Badge>
					{doc.citation && <Badge variant="outline">{doc.citation}</Badge>}
					{doc.sourceUrl && (
						<Button variant="link" size="sm" className="h-auto px-1" asChild>
							<a href={doc.sourceUrl} target="_blank" rel="noreferrer">
								View official source
								<ExternalLink data-icon="inline-end" />
							</a>
						</Button>
					)}
				</div>
			</header>
			<Separator className="my-5" />
			{error && <p className="text-sm text-destructive">Could not render document: {error}</p>}
			{!error && !Content && (
				<div className="flex flex-col gap-3">
					<Skeleton className="h-4 w-3/4" />
					<Skeleton className="h-4 w-full" />
					<Skeleton className="h-4 w-5/6" />
				</div>
			)}
			{!error && Content && (
				<div ref={proseRef} className="prose prose-neutral dark:prose-invert max-w-none">
					<Content />
				</div>
			)}
			{pending && (
				<Button
					size="sm"
					className="absolute z-10 shadow-md"
					style={{ top: pending.top, left: pending.left }}
					// mousedown, not click: a click would first collapse the selection.
					onMouseDown={(event) => {
						event.preventDefault();
						askAboutSelection();
					}}
				>
					<MessageCircleQuestion data-icon="inline-start" />
					Ask about this
				</Button>
			)}
			{cards.map((card) =>
				createPortal(
					<ExplainCard
						key={card.id}
						doc={doc}
						selection={card.selection}
						context={card.context}
						onDismiss={() => {
							card.host.remove();
							setCards((all) => all.filter((c) => c.id !== card.id));
						}}
					/>,
					card.host,
					card.id,
				),
			)}
		</article>
	);
}

// The direct child of the prose container that holds `node`: the paragraph,
// list, heading, or table the selection ends in.
function topLevelBlock(node: Node, prose: HTMLElement): HTMLElement | null {
	const el = node instanceof HTMLElement ? node : node.parentElement;
	if (!el || el === prose) return null;
	if (el.parentElement === prose) return el;
	return topLevelBlock(el.parentElement as Node, prose);
}
