export interface DocumentSummary {
	key: string;
	title: string;
	jurisdiction: string;
	citation: string;
	sourceUrl: string;
	level: string;
	authors: string;
	issuingBody: string;
}

export interface DocumentRecord extends DocumentSummary {
	body: string;
}

// One search_laws result as the tool returns it (see regulation.ts).
export interface DocumentMatch extends DocumentSummary {
	excerpts: { text: string; score: number }[];
}

// A tab in the Resources panel. Search results carry only metadata, so a tab
// opens in the loading state and fills in once the client fetches the text.
export type OpenDocument = DocumentSummary &
	({ status: 'loading' } | { status: 'ready'; body: string } | { status: 'error'; error: string });
