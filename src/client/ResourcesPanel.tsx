import { ChevronDown, ChevronUp, ExternalLink, Highlighter, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { applyHighlights, clearHighlights, supportsHighlights, type Passage } from './highlights.ts';
import { useCompiledMdx } from './mdx.tsx';
import { jurisdictionLabel, LevelBadge } from './LevelBadge.tsx';
import type { DocumentRecord } from './types.ts';

// One tab per document the agent has opened via open_law. The panel has no
// browsable library on purpose: the bucket will hold far too many laws to
// enumerate, so documents appear only when the agent surfaces them.
export function ResourcesPanel({
	openDocs,
	passages,
	activeKey,
	onSelect,
	onClose,
}: {
	openDocs: DocumentRecord[];
	passages: Record<string, Passage[]>;
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
						<DocumentView doc={doc} passages={passages[doc.key] ?? []} />
					</ScrollArea>
				</TabsContent>
			))}
		</Tabs>
	);
}

function DocumentView({ doc, passages }: { doc: DocumentRecord; passages: Passage[] }) {
	const { Content, error } = useCompiledMdx(doc.body);
	const proseRef = useRef<HTMLDivElement>(null);
	const [cited, setCited] = useState<Range[]>([]);
	const [retrieved, setRetrieved] = useState(0);
	const [cursor, setCursor] = useState(-1);

	// Re-paint whenever the prose mounts or the passage list grows (tool parts
	// stream in while the agent is still working). Only one DocumentView is
	// mounted at a time, so the page-wide highlight registry is ours to reset.
	useEffect(() => {
		const root = proseRef.current;
		if (!root || !Content) return;
		const result = applyHighlights(root, passages);
		setCited(result.anchors);
		setRetrieved(result.matched.retrieved);
		setCursor(-1);
		return clearHighlights;
	}, [Content, passages]);

	// The first cited passage scrolls into view on its own; later ones are a
	// click away. Ranges have no scrollIntoView, so the nearest element stands in.
	// Only `cited` is a dependency on purpose: a jump should not re-fire when
	// the cursor moves.
	useEffect(() => {
		if (cursor === -1 && cited.length > 0) jumpTo(0);
	}, [cited]);

	function jumpTo(index: number) {
		const range = cited[index];
		if (!range) return;
		setCursor(index);
		const node = range.startContainer;
		const element = node instanceof Element ? node : node.parentElement;
		element?.scrollIntoView({ block: 'center', behavior: 'smooth' });
	}

	return (
		<article className="mx-auto max-w-3xl p-6">
			<header className="flex flex-col gap-3">
				<h2 className="font-heading text-2xl font-semibold tracking-tight">{doc.title}</h2>
				<div className="flex flex-wrap items-center gap-1.5">
					<LevelBadge level={doc.level} />
					{jurisdictionLabel(doc.level, doc.jurisdiction) && (
						<Badge variant="secondary">{doc.jurisdiction}</Badge>
					)}
					{doc.citation && <Badge variant="outline">{doc.citation}</Badge>}
					{doc.issuingBody && <Badge variant="outline">{doc.issuingBody}</Badge>}
					{doc.sourceUrl && (
						<Button variant="link" size="sm" className="h-auto px-1" asChild>
							<a href={doc.sourceUrl} target="_blank" rel="noreferrer">
								View official source
								<ExternalLink data-icon="inline-end" />
							</a>
						</Button>
					)}
				</div>
				{doc.authors && (
					<p className="text-sm text-muted-foreground">Authors: {doc.authors}</p>
				)}
			</header>
			<Separator className="my-5" />
			{supportsHighlights() && (cited.length > 0 || retrieved > 0) && (
				<div className="sticky top-2 z-10 mb-4 flex w-fit items-center gap-1 rounded-full border bg-background/95 py-1 pr-1 pl-3 text-xs shadow-sm backdrop-blur">
					<Highlighter className="size-3.5 text-muted-foreground" />
					{/* The swatches are the legend: each one is the color that kind of passage is painted in. */}
					<span className="flex items-center gap-2">
						{cited.length > 0 && (
							<span className="flex items-center gap-1">
								<Swatch kind="cited" />
								{cited.length} cited{cursor >= 0 && ` (${cursor + 1}/${cited.length})`}
							</span>
						)}
						{retrieved > 0 && (
							<span className="flex items-center gap-1 text-muted-foreground">
								<Swatch kind="retrieved" />
								{retrieved} retrieved
							</span>
						)}
					</span>
					{cited.length > 1 && (
						<span className="ml-1 flex">
							<Button
								variant="ghost"
								size="icon"
								className="size-6"
								aria-label="Previous cited passage"
								onClick={() => jumpTo((cursor - 1 + cited.length) % cited.length)}
							>
								<ChevronUp className="size-3.5" />
							</Button>
							<Button
								variant="ghost"
								size="icon"
								className="size-6"
								aria-label="Next cited passage"
								onClick={() => jumpTo((cursor + 1) % cited.length)}
							>
								<ChevronDown className="size-3.5" />
							</Button>
						</span>
					)}
				</div>
			)}
			{error && <p className="text-sm text-destructive">Could not render document: {error}</p>}
			{!error && !Content && (
				<div className="flex flex-col gap-3">
					<Skeleton className="h-4 w-3/4" />
					<Skeleton className="h-4 w-full" />
					<Skeleton className="h-4 w-5/6" />
				</div>
			)}
			{!error && Content && (
				// Selecting text here enables the explain shortcut (see SelectionExplain).
				<div
					ref={proseRef}
					data-explain-region="document"
					data-explain-doc={doc.key}
					className="prose prose-neutral dark:prose-invert max-w-none"
				>
					<Content />
				</div>
			)}
		</article>
	);
}

function Swatch({ kind }: { kind: 'cited' | 'retrieved' }) {
	return (
		<span
			aria-hidden
			className="inline-block size-3 rounded-sm border border-foreground/10"
			style={{ backgroundColor: `var(--highlight-${kind})` }}
		/>
	);
}
