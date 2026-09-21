import { ExternalLink, FileText, Library, X } from 'lucide-react';
import { useEffect, useState } from 'react';
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
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCompiledMdx } from './mdx.tsx';
import type { DocumentRecord, DocumentSummary } from './types.ts';

const LIBRARY_TAB = 'library';

export function ResourcesPanel({
	openDocs,
	activeKey,
	onSelect,
	onClose,
	onOpen,
}: {
	openDocs: DocumentRecord[];
	activeKey: string | null;
	onSelect: (key: string | null) => void;
	onClose: (key: string) => void;
	onOpen: (key: string) => void;
}) {
	const [library, setLibrary] = useState<DocumentSummary[] | null>(null);

	useEffect(() => {
		fetch('/api/documents')
			.then((res) => res.json() as Promise<DocumentSummary[]>)
			.then((docs) => setLibrary(docs))
			.catch(() => setLibrary([]));
	}, []);

	return (
		<Tabs
			value={activeKey ?? LIBRARY_TAB}
			onValueChange={(value) => onSelect(value === LIBRARY_TAB ? null : value)}
			className="min-h-0 gap-0"
		>
			<div className="shrink-0 overflow-x-auto border-b">
				<TabsList variant="line" className="h-10 w-full justify-start px-2">
					<TabsTrigger value={LIBRARY_TAB} className="flex-none">
						<Library data-icon="inline-start" />
						Library
					</TabsTrigger>
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

			<TabsContent value={LIBRARY_TAB} className="min-h-0">
				<ScrollArea className="h-full">
					<LibraryList library={library} onOpen={onOpen} />
				</ScrollArea>
			</TabsContent>
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

function LibraryList({
	library,
	onOpen,
}: {
	library: DocumentSummary[] | null;
	onOpen: (key: string) => void;
}) {
	if (library === null) {
		return (
			<div className="flex flex-col gap-3 p-4">
				{Array.from({ length: 4 }, (_, i) => (
					<Skeleton key={i} className="h-12 w-full" />
				))}
			</div>
		);
	}
	if (library.length === 0) {
		return (
			<Empty className="mt-16 border-0">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<Library />
					</EmptyMedia>
					<EmptyTitle>No documents yet</EmptyTitle>
					<EmptyDescription>
						Upload Markdown documents to the R2 bucket to populate the library.
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}
	return (
		<ul className="flex flex-col p-2">
			{library.map((doc) => (
				<li key={doc.key}>
					<Button
						variant="ghost"
						onClick={() => onOpen(doc.key)}
						className="h-auto w-full flex-col items-start gap-1 px-3 py-2.5 text-left whitespace-normal"
					>
						<span className="flex items-center gap-2 font-medium">
							<FileText className="size-4 text-muted-foreground" />
							{doc.title}
						</span>
						<span className="flex flex-wrap gap-1.5 pl-6">
							<Badge variant="secondary">{doc.jurisdiction}</Badge>
							{doc.citation && <Badge variant="outline">{doc.citation}</Badge>}
						</span>
					</Button>
				</li>
			))}
		</ul>
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
				<div className="prose prose-neutral dark:prose-invert max-w-none">
					<Content />
				</div>
			)}
		</article>
	);
}
