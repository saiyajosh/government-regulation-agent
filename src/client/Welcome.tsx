import { ArrowRight, BookOpenText, Landmark, MessageCircleQuestion, Quote, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

const CAPABILITIES = [
	{
		icon: Search,
		title: 'Search a sourced library',
		body: 'Greenhouse gas statutes, regulations, and rules at the federal, California, and Bay Area levels.',
	},
	{
		icon: Quote,
		title: 'Grounded, cited answers',
		body: 'Every claim points at the document and citation it came from. No guessing.',
	},
	{
		icon: BookOpenText,
		title: 'Read the full text',
		body: 'Documents the agent relies on open beside the chat so you can verify.',
	},
];

const STEPS = [
	{ label: 'Ask', body: 'Describe the law, rule, or situation in plain language.' },
	{ label: 'Research', body: 'The agent searches the library and opens what matters.' },
	{ label: 'Verify', body: 'Read the cited text side by side with the answer.' },
];

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

// Screenshots live in public/explain and are captured from the running app.
const EXPLAIN_STEPS = [
	{
		src: '/explain/1-highlight.png',
		alt: 'A phrase highlighted in a document with a small "Ask a question" hint beneath it',
		title: 'Highlight',
		body: 'Select any passage in a document or a reply. A small hint appears under it.',
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
		<div className="relative mx-auto flex w-full max-w-3xl flex-col gap-10 px-2 pt-10 pb-6 sm:pt-16">
			<div
				aria-hidden
				className="pointer-events-none absolute inset-x-0 -top-10 -z-10 h-72 bg-[radial-gradient(ellipse_at_top,var(--color-muted)_0%,transparent_70%)]"
			/>

			<section className="flex flex-col items-center gap-4 text-center animate-in fade-in slide-in-from-bottom-2 duration-500">
				<div className="flex size-14 items-center justify-center rounded-2xl border bg-background shadow-sm ring-4 ring-muted">
					<Landmark className="size-6" />
				</div>
				<div className="flex flex-col gap-2">
					<h2 className="font-heading text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
						Understand greenhouse gas regulation, from the source
					</h2>
					<p className="mx-auto max-w-md text-sm text-muted-foreground text-balance sm:text-base">
						A research assistant for federal, California, and Bay Area climate rules that
						answers only from a library of official documents and shows you the text it used.
					</p>
				</div>
			</section>

			<section className="grid gap-3 sm:grid-cols-3 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-150 fill-mode-both">
				{CAPABILITIES.map((item) => (
					<div
						key={item.title}
						className="flex flex-col gap-2 rounded-xl border bg-card p-4 shadow-xs transition-colors hover:bg-accent/40"
					>
						<item.icon className="size-4 text-muted-foreground" />
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
							<span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary font-mono text-[11px] font-semibold text-primary-foreground">
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
					Try asking
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
								'transition-colors hover:border-foreground/30 hover:bg-accent disabled:opacity-50',
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
