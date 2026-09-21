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
