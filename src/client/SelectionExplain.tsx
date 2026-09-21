import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ExplainInput } from '../lib/explain.ts';
import { ExplainCard, ExplainPrompt } from './ExplainCard.tsx';
import type { DocumentRecord } from './types.ts';

// Passive selection tracking for every `[data-explain-region]` on the page:
// document prose (with `data-explain-doc` naming the open document) and
// assistant chat replies. Selecting text is never interrupted; once the
// selection settles (mouse up, or a keyboard selection) a small hint appears
// under it, and ⌘/ (or Ctrl+/) opens the question prompt. Answers are
// portaled into a host <div> inserted directly after the block the selection
// ended in, so the React-owned document/chat trees are never mutated.
export function SelectionExplain({ openDocs }: { openDocs: DocumentRecord[] }) {
	const [pending, setPending] = useState<{
		text: string;
		block: HTMLElement;
		region: HTMLElement;
		top: number;
		left: number;
		prompt: boolean;
	} | null>(null);
	const [cards, setCards] = useState<
		{ id: string; input: ExplainInput; question: string; host: HTMLDivElement }[]
	>([]);

	useEffect(() => {
		let mouseDown = false;

		function readSelection() {
			const selection = window.getSelection();
			if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
			const range = selection.getRangeAt(0);
			const anchor =
				range.commonAncestorContainer instanceof Element
					? range.commonAncestorContainer
					: range.commonAncestorContainer.parentElement;
			const region = anchor?.closest<HTMLElement>('[data-explain-region]');
			const text = selection.toString().trim();
			const block = region ? topLevelBlock(range.endContainer, region) : null;
			if (!region || !text || !block) return null;
			const rect = range.getBoundingClientRect();
			return {
				text,
				block,
				region,
				top: rect.bottom + 6,
				left: Math.max(8, Math.min(rect.left, window.innerWidth - 340)),
			};
		}

		function settle() {
			const next = readSelection();
			if (!next) return;
			setPending((current) => (current?.prompt ? current : { ...next, prompt: false }));
		}

		function onSelectionChange() {
			if (mouseDown) return;
			// A collapsed selection clears the hint but never an open prompt
			// (focusing the prompt's input collapses the selection).
			const next = readSelection();
			if (!next) return setPending((current) => (current?.prompt ? current : null));
			settle();
		}
		function onMouseDown(event: MouseEvent) {
			if (event.target instanceof Element && event.target.closest('[data-explain-ui]')) return;
			mouseDown = true;
			setPending(null);
		}
		function onMouseUp() {
			mouseDown = false;
			// Let the browser finish committing the selection first.
			setTimeout(settle, 0);
		}
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === 'Escape') return setPending(null);
			// ⌘/ on Mac, Ctrl+/ elsewhere. `code` covers layouts where `/` needs a modifier.
			if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
			if (event.key !== '/' && event.code !== 'Slash') return;
			const next = readSelection();
			setPending((current) => {
				const base = next ?? current;
				if (!base) return null;
				event.preventDefault();
				return { ...base, prompt: true };
			});
		}

		document.addEventListener('selectionchange', onSelectionChange);
		document.addEventListener('mousedown', onMouseDown);
		document.addEventListener('mouseup', onMouseUp);
		document.addEventListener('keydown', onKeyDown);
		return () => {
			document.removeEventListener('selectionchange', onSelectionChange);
			document.removeEventListener('mousedown', onMouseDown);
			document.removeEventListener('mouseup', onMouseUp);
			document.removeEventListener('keydown', onKeyDown);
		};
	}, []);

	function ask(question: string) {
		if (!pending) return;
		const input = buildInput(pending, openDocs);
		if (!input) return setPending(null);
		const host = document.createElement('div');
		// Not `.after()`: workers-types' HTMLRewriter `Element` shadows the DOM signature.
		pending.block.insertAdjacentElement('afterend', host);
		setCards((all) => [...all, { id: crypto.randomUUID(), input, question, host }]);
		window.getSelection()?.removeAllRanges();
		setPending(null);
	}

	return (
		<>
			{pending && (
				<div
					data-explain-ui
					className="fixed z-50"
					style={{ top: pending.top, left: pending.left }}
				>
					{pending.prompt ? (
						<ExplainPrompt
							key={pending.text}
							selection={pending.text}
							onSubmit={ask}
							onCancel={() => setPending(null)}
						/>
					) : (
						<ShortcutHint onActivate={() => setPending({ ...pending, prompt: true })} />
					)}
				</div>
			)}
			{cards.map((card) =>
				createPortal(
					<ExplainCard
						key={card.id}
						input={card.input}
						question={card.question}
						onDismiss={() => {
							card.host.remove();
							setCards((all) => all.filter((c) => c.id !== card.id));
						}}
					/>,
					card.host,
					card.id,
				),
			)}
		</>
	);
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

// The minimal command list shown under a settled selection. One command today;
// the list shape leaves room for more.
function ShortcutHint({ onActivate }: { onActivate: () => void }) {
	return (
		<div className="flex items-center gap-2 rounded-md border bg-popover/95 px-2 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
			<button
				type="button"
				className="flex items-center gap-2 hover:text-foreground"
				// mousedown, not click: a click would first collapse the selection.
				onMouseDown={(event) => {
					event.preventDefault();
					onActivate();
				}}
			>
				Ask a question
				<kbd className="rounded border bg-muted px-1 font-mono text-[10px] text-foreground/70">
					{isMac ? '⌘/' : 'Ctrl+/'}
				</kbd>
			</button>
		</div>
	);
}

function buildInput(
	pending: { text: string; block: HTMLElement; region: HTMLElement },
	openDocs: DocumentRecord[],
): ExplainInput | null {
	const context = pending.block.textContent?.trim() ?? '';
	if (pending.region.dataset.explainRegion === 'chat') {
		return {
			source: 'chat',
			key: 'chat',
			title: 'Research assistant reply',
			jurisdiction: '',
			citation: '',
			body: pending.region.textContent?.trim() ?? '',
			selection: pending.text,
			context,
		};
	}
	const doc = openDocs.find((d) => d.key === pending.region.dataset.explainDoc);
	if (!doc) return null;
	return {
		source: 'document',
		key: doc.key,
		title: doc.title,
		jurisdiction: doc.jurisdiction,
		citation: doc.citation,
		body: doc.body,
		selection: pending.text,
		context,
	};
}

// The direct child of the region that holds `node`: the paragraph, list,
// heading, or table the selection ends in.
function topLevelBlock(node: Node, region: HTMLElement): HTMLElement | null {
	const el = node instanceof HTMLElement ? node : node.parentElement;
	if (!el || el === region) return null;
	if (el.parentElement === region) return el;
	return topLevelBlock(el.parentElement as Node, region);
}
