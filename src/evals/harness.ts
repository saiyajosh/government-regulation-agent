import { init, useInitialData, type Agent } from '@flue/runtime';
import { array, object, optional, parse, string } from 'valibot';
import { memoryLibrary } from '../lib/documents.ts';
import { explainInput, type ExplainInput } from '../lib/explain.ts';
import { explainAgent, type WebResult } from '../agents/explain.ts';
import { regulationAgent } from '../agents/regulation.ts';
import { FIXTURES, WEB_FIXTURES } from './fixtures.ts';

// The Regulation agent over the fixture corpus: the same body the Worker
// runs, minus the Cloudflare bindings. Registered under start() by name.
export function RegulationEval() {
	return regulationAgent(memoryLibrary(FIXTURES));
}

// The Explain agent over a fixture web searcher: every query returns the
// same official-looking pages, so a web-backed answer is checkable.
export function ExplainEval() {
	return explainAgent(useInitialData<ExplainInput | undefined>(), async () => WEB_FIXTURES);
}

ExplainEval.initialData = explainInput;

export type { WebResult };

export interface ToolCall {
	name: string;
	input: unknown;
}

// One fresh conversation per case: send the prompt, await the settled reply,
// and collect every tool call the model made along the way.
export async function ask(agent: Agent, prompt: string, options: { initialData?: unknown } = {}) {
	const toolCalls: ToolCall[] = [];
	const handle = init(agent);
	const receipt = await handle.dispatch({ message: prompt, initialData: options.initialData });

	const reply = await handle.read(receipt, {
		onEvent: (chunk) => {
			if (chunk.type === 'tool-input') toolCalls.push({ name: chunk.toolName, input: chunk.input });
		},
	});

	return { reply, toolCalls };
}

// Typed views of the tool calls a run made. Parsing (rather than asserting)
// also fails a case whose tool inputs do not match the tool's schema.
export function searchCalls(toolCalls: ToolCall[]) {
	return toolCalls.flatMap((call) =>
		call.name === 'search_laws'
			? [parse(object({ query: string(), level: optional(string()), jurisdiction: optional(string()) }), call.input)]
			: [],
	);
}

export function openedKeys(toolCalls: ToolCall[]) {
	return toolCalls.flatMap((call) => (call.name === 'open_law' ? [parse(object({ key: string() }), call.input).key] : []));
}

export function highlightCalls(toolCalls: ToolCall[]) {
	return toolCalls.flatMap((call) =>
		call.name === 'highlight_passages' ? [parse(object({ key: string(), passages: array(string()) }), call.input)] : [],
	);
}

// Whitespace-insensitive containment check for "verbatim" quotes.
export function quotes(body: string, passage: string) {
	const squash = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

	return squash(body).includes(squash(passage));
}
