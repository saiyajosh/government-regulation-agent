import { ExternalLink, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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

	return (
		<article className="mx-auto max-w-3xl p-6">
			<header className="flex flex-col gap-3">
				<h2 className="font-heading text-2xl font-semibold tracking-tight">{doc.title}</h2>
				<div className="flex flex-wrap items-center gap-1.5">
					<Badge variant="secondary">{doc.jurisdiction}</Badge>
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
