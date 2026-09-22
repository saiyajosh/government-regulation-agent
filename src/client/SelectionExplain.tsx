import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
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
export function SelectionExplain({
	openDocs,
	chatStarted,
}: {
	openDocs: DocumentRecord[];
	chatStarted: boolean;
}) {
	const [pending, setPending] = useState<Pending | null>(null);
	// Mirror for the native listeners, which must read the latest value without
	// smuggling side effects into a state updater.
	const pendingRef = useRef<Pending | null>(null);
	pendingRef.current = pending;

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
				rectTop: rect.top,
				rectBottom: rect.bottom,
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
			const base = readSelection() ?? pendingRef.current;

			if (!base) return;
			event.preventDefault();
			event.stopPropagation();
			setPending({ ...base, prompt: true });
		}

		document.addEventListener('selectionchange', onSelectionChange);
		document.addEventListener('mousedown', onMouseDown);
		document.addEventListener('mouseup', onMouseUp);
		// Capture phase on window so no focused control can swallow the shortcut.
		window.addEventListener('keydown', onKeyDown, true);

		return () => {
			document.removeEventListener('selectionchange', onSelectionChange);
			document.removeEventListener('mousedown', onMouseDown);
			document.removeEventListener('mouseup', onMouseUp);
			window.removeEventListener('keydown', onKeyDown, true);
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

	// A once-per-session nudge for ~10 seconds when the chat first begins,
	// unless the user has already selected something by then.
	const [nudge, setNudge] = useState(false);
	useEffect(() => {
		if (!chatStarted || !claimNudge()) return;
		setNudge(true);
		const timer = setTimeout(() => setNudge(false), 10_000);

		return () => clearTimeout(timer);
	}, [chatStarted]);
	useEffect(() => {
		if (pending) setNudge(false);
	}, [pending]);

	// Sit below the selection, or above it when the prompt would run off the
	// bottom of the viewport (replies in the chat usually end right there).
	const placement = pending
		? pending.rectBottom + (pending.prompt ? PROMPT_HEIGHT : HINT_HEIGHT) < window.innerHeight
			? { top: pending.rectBottom + 6 }
			: { bottom: window.innerHeight - pending.rectTop + 6 }
		: null;

	return (
		<>
			{nudge && !pending && (
				<div className="pointer-events-none fixed bottom-20 left-1/2 z-40 -translate-x-1/2 animate-in fade-in slide-in-from-bottom-1 duration-300">
					<div className={cn(hintPill, 'px-3 py-1.5')}>
						Highlight any text and ask a question to dig in with
						<kbd className={hintKbd}>{isMac ? '⌘/' : 'Ctrl+/'}</kbd>
					</div>
				</div>
			)}
			{pending && placement && (
				<div data-explain-ui className="fixed z-50" style={{ ...placement, left: pending.left }}>
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

const NUDGE_STORAGE_KEY = 'gra:explain-nudge-shown';

function claimNudge() {
	try {
		if (sessionStorage.getItem(NUDGE_STORAGE_KEY)) return false;
		sessionStorage.setItem(NUDGE_STORAGE_KEY, '1');

		return true;
	} catch {
		return true;
	}
}

type Pending = {
	text: string;
	block: HTMLElement;
	region: HTMLElement;
	rectTop: number;
	rectBottom: number;
	left: number;
	prompt: boolean;
};

// Approximate rendered heights, for choosing above vs. below the selection.
const HINT_HEIGHT = 40;

const PROMPT_HEIGHT = 110;

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

// The minimal command list shown under a settled selection. One command today;
// the list shape leaves room for more.
const hintPill =
	'flex items-center gap-2 rounded-md border border-violet-300 bg-violet-50/95 text-xs text-violet-800 shadow-sm backdrop-blur dark:border-violet-800 dark:bg-violet-950/95 dark:text-violet-200';

const hintKbd =
	'rounded border border-violet-300 bg-violet-100 px-1 font-mono text-[10px] text-violet-900 dark:border-violet-700 dark:bg-violet-900 dark:text-violet-100';

function ShortcutHint({ onActivate }: { onActivate: () => void }) {
	return (
		<div className={cn(hintPill, 'px-2 py-1')}>
			<button
				type="button"
				className="flex items-center gap-2 hover:text-violet-950 dark:hover:text-white"
				// mousedown, not click: a click would first collapse the selection.
				onMouseDown={(event) => {
					event.preventDefault();
					onActivate();
				}}
			>
				Ask a question
				<kbd className={hintKbd}>{isMac ? '⌘/' : 'Ctrl+/'}</kbd>
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
	const parent = el.parentElement;

	if (!parent) return null;

	if (parent === region) return el;

	return topLevelBlock(parent, region);
}
