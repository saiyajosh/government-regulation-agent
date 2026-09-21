'use agent';
import { setProvider, useInitialData, useModel } from '@flue/runtime';
import { object, string, type InferOutput } from 'valibot';
import { GATEWAY_MODEL, gatewayProvider } from '../lib/gateway.ts';

setProvider(gatewayProvider());

// Everything the throwaway explainer knows arrives once, at instance creation:
// the document the user is reading and the passage they highlighted. The client
// already holds the full document body (open_law returned it), so it ships the
// body rather than making the agent re-read R2.
const explainInput = object({
	key: string(),
	title: string(),
	jurisdiction: string(),
	citation: string(),
	body: string(),
	selection: string(),
	// The full paragraph/list item/heading the selection sits in.
	context: string(),
});

export type ExplainInput = InferOutput<typeof explainInput>;

// A single-question, single-answer explainer for a highlighted passage. Each
// highlight creates a fresh conversation (the client mints a new id), the user
// asks one question, and the conversation is never contacted again. No tools:
// the answer must come from the supplied document text alone.
export function ExplainAgent() {
	useModel(GATEWAY_MODEL);
	const input = useInitialData<ExplainInput | undefined>();

	return [
		'You answer exactly one question about a passage the reader highlighted in a legal document.',
		'Answer only from the document text below. Do not use outside knowledge, do not search, and do not speculate about other laws.',
		'Be direct and concise: two to four sentences, plain language, no preamble, no restating the question, no closing offers or follow-up suggestions.',
		'When the document defines or qualifies the term, quote the exact clause and say where in the document it appears (section heading or number).',
		'If the document does not answer the question, say so in one sentence and stop.',
		'Reply in plain prose. No headings, no bullet lists, no markdown formatting.',
		'',
		input
			? [
					`<document key="${input.key}" title="${input.title}" jurisdiction="${input.jurisdiction}" citation="${input.citation}">`,
					input.body,
					'</document>',
					'',
					'<highlighted>',
					input.selection,
					'</highlighted>',
					'',
					'<surrounding_passage>',
					input.context,
					'</surrounding_passage>',
				].join('\n')
			: 'No document was supplied. Tell the reader to highlight a passage and ask again.',
	].join('\n');
}

ExplainAgent.agentName = 'Explain';
ExplainAgent.initialData = explainInput;
