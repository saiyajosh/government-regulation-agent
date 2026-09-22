import { ArrowRight, MessageCircleQuestion } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LEVELS } from './LevelBadge.tsx';

// The three slices of the corpus, in the order the agent's system prompt
// describes them. Each line names what is actually seeded, so the strip
// doubles as an honest "what we do not cover" signal.
const SCOPES = [
	{
		level: 'federal',
		emoji: '🇺🇸',
		title: 'Federal',
		body: 'Clean Air Act, EPA source rules, the GHG Reporting Program, efficiency standards, and Federal Register rules since 2020.',
	},
	{
		level: 'state',
		emoji: '🐻',
		title: 'California',
		body: 'AB 32 and its successors, CARB reporting, cap-and-trade, the Low Carbon Fuel Standard, and Advanced Clean Cars.',
	},
	{
		level: 'regional',
		emoji: '🌉',
		title: 'Bay Area',
		body: 'Air District rules plus Oakland, San Jose, and San Francisco codes on climate, electrification, and vehicles.',
	},
];

const CAPABILITIES = [
	{
		emoji: '🔎',
		title: 'Search a sourced library',
		body: 'Emissions caps, reporting duties, fuel standards, and air district rules, all pulled from official text.',
	},
	{
		emoji: '📌',
		title: 'Grounded, cited answers',
		body: 'Every claim points at the statute or rule it came from. No guessing, no outside knowledge.',
	},
	{
		emoji: '📖',
		title: 'Read the full text',
		body: 'Rules the agent relies on open beside the chat so you can check the wording yourself.',
	},
];

const STEPS = [
	{ label: 'Ask', body: 'Describe the emissions rule, program, or situation in plain language.' },
	{ label: 'Research', body: 'The agent searches federal, California, and Bay Area sources and opens what matters.' },
	{ label: 'Verify', body: 'Read the cited text side by side with the answer.' },
];

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

// Screenshots live in public/explain and are captured from the running app.
const EXPLAIN_STEPS = [
	{
		src: '/explain/1-highlight.png',
		alt: 'A phrase highlighted in a document with a small "Ask a question" hint beneath it',
		title: 'Highlight',
		body: 'Select any passage in a rule or a reply. A small hint appears under it.',
	},
	{
		src: '/explain/2-ask.png',
		alt: 'A question typed into the purple prompt that opened under the highlighted phrase',
		title: 'Ask',
		body: 'Press the shortcut and type one focused question about that text.',
	},
	{
		src: '/explain/3-answer.png',
		alt: 'A concise answer card inserted directly below the paragraph',
		title: 'Read',
		body: 'A short answer, grounded only in that text, appears right below the passage.',
	},
];

const PROMPTS = [
	'Which facilities must report under the EPA Greenhouse Gas Reporting Program?',
	'What methane limits apply to existing oil and gas wells?',
	'What does AB 32 require the California Air Resources Board to do?',
	'Who must hold compliance instruments under California cap-and-trade?',
	'What does BAAQMD require after a significant methane release?',
	'Does San Jose prohibit natural gas in new buildings?',
];

export function Welcome({ onPrompt, disabled }: { onPrompt: (text: string) => void; disabled?: boolean }) {
	return (
		<div className="relative isolate mx-auto flex w-full max-w-3xl flex-col gap-10 px-2 pt-10 pb-6 sm:pt-16">
			<div
				aria-hidden
				className="pointer-events-none absolute inset-x-0 -top-10 -z-10 h-72 bg-[radial-gradient(ellipse_at_top,var(--color-emerald-100)_0%,transparent_70%)] dark:bg-[radial-gradient(ellipse_at_top,var(--color-emerald-950)_0%,transparent_70%)]"
			/>

			<section className="flex flex-col items-center gap-4 text-center animate-in fade-in slide-in-from-bottom-2 duration-500">
				<div
					aria-hidden
					className="flex size-14 items-center justify-center rounded-2xl border border-emerald-200 bg-background text-3xl shadow-sm ring-4 ring-emerald-100 dark:border-emerald-800 dark:ring-emerald-950"
				>
					🌱
				</div>
				<div className="flex flex-col gap-2">
					<h2 className="font-heading text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
						Understand greenhouse gas rules, from the source 🌍
					</h2>
					<p className="mx-auto max-w-md text-sm text-muted-foreground text-balance sm:text-base">
						A green research assistant for federal, California, and Bay Area climate regulation.
						It answers only from official documents and shows you the text it used, so you can
						act on the rules that help the planet.
					</p>
				</div>
			</section>

			<section className="flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-100 fill-mode-both">
				<h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
					What the library covers
				</h3>
				<div className="grid gap-3 sm:grid-cols-3">
					{SCOPES.map((scope) => (
						<div
							key={scope.title}
							className={cn(
								'flex flex-col gap-2 rounded-xl border p-4 shadow-xs transition-colors',
								LEVELS.get(scope.level)?.surface,
							)}
						>
							<div className="flex items-center gap-2">
								<span aria-hidden className="text-lg leading-none">
									{scope.emoji}
								</span>
								<h4 className="text-sm font-semibold">{scope.title}</h4>
							</div>
							<p className="text-xs leading-relaxed text-muted-foreground">{scope.body}</p>
						</div>
					))}
				</div>
			</section>

			<section className="grid gap-3 sm:grid-cols-3 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-200 fill-mode-both">
				{CAPABILITIES.map((item) => (
					<div
						key={item.title}
						className="flex flex-col gap-2 rounded-xl border bg-card p-4 shadow-xs transition-colors hover:bg-accent/40"
					>
						<span aria-hidden className="text-base leading-none">
							{item.emoji}
						</span>
						<h3 className="text-sm font-medium">{item.title}</h3>
						<p className="text-xs leading-relaxed text-muted-foreground">{item.body}</p>
					</div>
				))}
			</section>

			<section className="flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-300 fill-mode-both">
				<h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
					How it works
				</h3>
				<ol className="grid gap-2 sm:grid-cols-3">
					{STEPS.map((step, index) => (
						<li key={step.label} className="relative flex gap-3 rounded-xl border border-dashed p-3">
							<span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 font-mono text-[11px] font-semibold text-white dark:bg-emerald-500">
								{index + 1}
							</span>
							<div className="flex flex-col gap-0.5">
								<span className="text-sm font-medium">{step.label}</span>
								<span className="text-xs leading-relaxed text-muted-foreground">{step.body}</span>
							</div>
							{index < STEPS.length - 1 && (
								<ArrowRight
									aria-hidden
									className="absolute top-1/2 -right-3 hidden size-3.5 -translate-y-1/2 text-muted-foreground/60 sm:block"
								/>
							)}
						</li>
					))}
				</ol>
			</section>

			<section className="flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-450 fill-mode-both">
				<div className="flex items-center gap-2">
					<MessageCircleQuestion className="size-3.5 text-violet-600 dark:text-violet-400" />
					<h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
						Dig into any passage
					</h3>
					<kbd className="rounded border border-violet-300 bg-violet-50 px-1 font-mono text-[10px] text-violet-900 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-100">
						{isMac ? '⌘/' : 'Ctrl+/'}
					</kbd>
				</div>
				<div className="grid gap-3 sm:grid-cols-3">
					{EXPLAIN_STEPS.map((step) => (
						<figure
							key={step.title}
							className="flex flex-col gap-2 overflow-hidden rounded-xl border border-violet-200 bg-violet-50/40 dark:border-violet-900 dark:bg-violet-950/30"
						>
							<img
								src={step.src}
								alt={step.alt}
								loading="lazy"
								className="aspect-[2/1] w-full border-b border-violet-200 object-cover object-left-top dark:border-violet-900"
							/>
							<figcaption className="flex flex-col gap-0.5 px-3 pb-3">
								<span className="text-sm font-medium">{step.title}</span>
								<span className="text-xs leading-relaxed text-muted-foreground">{step.body}</span>
							</figcaption>
						</figure>
					))}
				</div>
			</section>

			<section className="flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-600 fill-mode-both">
				<h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
					Try asking 💬
				</h3>
				<div className="flex flex-wrap gap-2">
					{PROMPTS.map((prompt) => (
						<button
							key={prompt}
							type="button"
							disabled={disabled}
							onClick={() => onPrompt(prompt)}
							className={cn(
								'group flex items-center gap-2 rounded-full border bg-background px-3.5 py-1.5 text-left text-xs',
								'transition-colors hover:border-emerald-500/50 hover:bg-emerald-50 disabled:opacity-50 dark:hover:bg-emerald-950/40',
							)}
						>
							{prompt}
							<ArrowRight className="size-3 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
						</button>
					))}
				</div>
			</section>
		</div>
	);
}
