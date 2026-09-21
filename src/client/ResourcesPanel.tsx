import { useEffect, useState } from 'react';
import { useCompiledMdx } from './mdx.tsx';
import type { DocumentRecord, DocumentSummary } from './types.ts';

function DocumentView({ doc }: { doc: DocumentRecord }) {
	const { Content, error } = useCompiledMdx(doc.body);

	return (
		<article className="document">
			<header>
				<h2>{doc.title}</h2>
				<p className="document-meta">
					{doc.jurisdiction}
					{doc.citation ? ` · ${doc.citation}` : ''}
				</p>
				{doc.sourceUrl && (
					<a href={doc.sourceUrl} target="_blank" rel="noreferrer">
						View official source
					</a>
				)}
			</header>
			{error && <p className="error">Could not render document: {error}</p>}
			{!error && Content && <Content />}
		</article>
	);
}

export function ResourcesPanel({
	openDocs,
	activeKey,
	onSelect,
	onClose,
	onOpen,
}: {
	openDocs: DocumentRecord[];
	activeKey: string | null;
	onSelect: (key: string) => void;
	onClose: (key: string) => void;
	onOpen: (key: string) => void;
}) {
	const [library, setLibrary] = useState<DocumentSummary[]>([]);
	const [browsing, setBrowsing] = useState(openDocs.length === 0);

	useEffect(() => {
		fetch('/api/documents')
			.then((res) => res.json() as Promise<DocumentSummary[]>)
			.then((docs) => setLibrary(docs))
			.catch(() => setLibrary([]));
	}, []);

	const active = openDocs.find((doc) => doc.key === activeKey) ?? null;

	return (
		<section className="resources-panel">
			<div className="tab-bar">
				<button
					className={browsing ? 'tab active' : 'tab'}
					onClick={() => setBrowsing(true)}
				>
					Library
				</button>
				{openDocs.map((doc) => (
					<button
						key={doc.key}
						className={!browsing && doc.key === activeKey ? 'tab active' : 'tab'}
						onClick={() => {
							setBrowsing(false);
							onSelect(doc.key);
						}}
					>
						{doc.title}
						<span
							className="tab-close"
							onClick={(event) => {
								event.stopPropagation();
								onClose(doc.key);
							}}
						>
							×
						</span>
					</button>
				))}
			</div>

			<div className="tab-content">
				{browsing ? (
					<ul className="library-list">
						{library.length === 0 && <li className="empty">No documents in the library yet.</li>}
						{library.map((doc) => (
							<li key={doc.key}>
								<button
									onClick={() => {
										onOpen(doc.key);
										setBrowsing(false);
									}}
								>
									<strong>{doc.title}</strong>
									<span>
										{doc.jurisdiction}
										{doc.citation ? ` · ${doc.citation}` : ''}
									</span>
								</button>
							</li>
						))}
					</ul>
				) : active ? (
					<DocumentView doc={active} />
				) : (
					<p className="empty">Select a document.</p>
				)}
			</div>
		</section>
	);
}
