export interface DocumentSummary {
	key: string;
	title: string;
	jurisdiction: string;
	citation: string;
	sourceUrl: string;
}

export interface DocumentRecord extends DocumentSummary {
	body: string;
}
