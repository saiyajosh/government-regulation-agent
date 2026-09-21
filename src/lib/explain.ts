import { object, picklist, string, type InferOutput } from 'valibot';

// Everything the throwaway explainer knows arrives once, at instance creation:
// the text the user was reading, the passage they highlighted, and the block
// (paragraph, list item, heading) that passage sits in. `source` says whether
// the text is a library document or an assistant reply from the main chat.
// Shared between the agent and the client, so it must not import agent code.
export const explainInput = object({
	source: picklist(['document', 'chat']),
	key: string(),
	title: string(),
	jurisdiction: string(),
	citation: string(),
	body: string(),
	selection: string(),
	context: string(),
});

export type ExplainInput = InferOutput<typeof explainInput>;
