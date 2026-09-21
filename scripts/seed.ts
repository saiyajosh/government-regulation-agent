// Seed the R2 document library from official, public-domain sources.
//
//   node scripts/seed.ts                 # fetch into ./seed/documents, no upload
//   node scripts/seed.ts --upload        # also upload via the running app (see below)
//   node scripts/seed.ts --only ecfr,ca  # subset of sources (see SOURCES)
//   node scripts/seed.ts --limit 20      # cap documents per source (default 40)
//
// Every document is one citable unit (a statute section, a CFR section, a
// Federal Register rule, a code section) written as Markdown with frontmatter
// and uploaded with matching x-amz-meta-* headers so AI Search can filter on
// them. Uploads go through the app's PUT /api/documents/:key route (Wrangler
// cannot set R2 custom metadata), so run `pnpm dev` first and set SEED_TOKEN
// in .env; SEED_URL overrides the default http://localhost:5173. Afterwards,
// trigger an index sync:
//   npx wrangler ai-search jobs create government-regulation-agent
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SEED_URL = process.env.SEED_URL ?? 'http://localhost:5173';
const OUT_DIR = path.resolve('seed/documents');
const args = process.argv.slice(2);
const flag = (name: string) => {
	const index = args.indexOf(`--${name}`);
	return index === -1 ? undefined : (args[index + 1] ?? '');
};
const UPLOAD = args.includes('--upload');
const LIMIT = Number(flag('limit') ?? 40);
const ONLY = flag('only')?.split(',').filter(Boolean);
const SEED_TOKEN = process.env.SEED_TOKEN ?? (await readEnvToken());
if (UPLOAD && !SEED_TOKEN) throw new Error('--upload needs SEED_TOKEN in the environment or .env');
let cachedEcfrDate: string | undefined;
const HEADERS = {
	'User-Agent': 'government-regulation-agent-seed/1.0',
	Accept: 'application/json, text/xml, text/html, */*',
};

interface Doc {
	// R2 key, e.g. federal/cfr/5-cfr-1201.3.md
	key: string;
	title: string;
	// "Federal", "California", "Miami-Dade County, Florida", "Oakland, California"
	jurisdiction: string;
	// federal | state | county | municipal
	level: string;
	citation: string;
	sourceUrl: string;
	authors: string;
	issuingBody: string;
	body: string;
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

const SOURCES: Record<string, () => Promise<Doc[]>> = {
	// Code of Federal Regulations via the eCFR versioner API. Section-level XML,
	// hierarchy metadata carries the citation, and the chapter label names the
	// issuing agency.
	async ecfr() {
		const PARTS = [
			{ title: 5, part: '2635' }, // OGE Standards of Ethical Conduct
			{ title: 5, part: '1201' }, // MSPB Practices and Procedures
			{ title: 1, part: '51' }, // Incorporation by reference (OFR)
		];
		const docs: Doc[] = [];
		for (const { title, part } of PARTS) {
			const structure = await json<EcfrNode>(
				`https://www.ecfr.gov/api/versioner/v1/structure/current/title-${title}.json`,
			);
			const chapter = findPath(structure, (n) => n.type === 'part' && n.identifier === part);
			if (!chapter) continue;
			const agency = chapter.path.find((n) => n.type === 'chapter')?.label_description ?? '';
			const sections = collect(chapter.node, (n) => n.type === 'section' && !n.reserved).slice(
				0,
				Math.ceil(LIMIT / PARTS.length),
			);
			for (const section of sections) {
				const xml = await text(
					`https://www.ecfr.gov/api/versioner/v1/full/${await ecfrDate()}/title-${title}.xml?part=${part}&section=${section.identifier}`,
				);
				docs.push({
					key: `federal/cfr/${title}-cfr-${section.identifier}.md`,
					title: `${title} CFR ${section.identifier} — ${section.label_description}`,
					jurisdiction: 'Federal',
					level: 'federal',
					citation: `${title} CFR § ${section.identifier}`,
					sourceUrl: `https://www.ecfr.gov/current/title-${title}/section-${section.identifier}`,
					authors: '',
					issuingBody: agency,
					body: htmlToMarkdown(xml.replace(/<HEAD>/g, '<h2>').replace(/<\/HEAD>/g, '</h2>')),
				});
			}
		}
		return docs;
	},

	// United States Code via GovInfo's per-section HTML (2024 edition). Title 5
	// chapter 5 subchapter II is the Administrative Procedure Act.
	async uscode() {
		const SECTIONS = ['551', '552', '552a', '552b', '553', '554', '555', '556', '557', '558', '559'];
		const docs: Doc[] = [];
		for (const section of SECTIONS.slice(0, LIMIT)) {
			const url = `https://www.govinfo.gov/content/pkg/USCODE-2024-title5/html/USCODE-2024-title5-partI-chap5-subchapII-sec${section}.htm`;
			const html = await text(url);
			const heading = /<h3 class="section-head">(.*?)<\/h3>/s.exec(html)?.[1] ?? `§${section}`;
			const bodyHtml = html.slice(html.indexOf('<h3 class="section-head">'));
			docs.push({
				key: `federal/usc/5-usc-${section}.md`,
				title: `5 U.S.C. ${htmlToMarkdown(heading).trim()}`,
				jurisdiction: 'Federal',
				level: 'federal',
				citation: `5 U.S.C. § ${section}`,
				sourceUrl: url,
				authors: '',
				issuingBody: 'United States Congress',
				body: htmlToMarkdown(bodyHtml.replace(/<h3 class="section-head">/, '<h2>').replace(/<\/h3>/, '</h2>')),
			});
		}
		return docs;
	},

	// Final rules from the Federal Register API (most recent first) with the
	// GPO plain-text body. Agencies become the issuing body.
	async federalRegister() {
		const fields = [
			'title',
			'document_number',
			'citation',
			'publication_date',
			'effective_on',
			'agency_names',
			'cfr_references',
			'abstract',
			'html_url',
			'raw_text_url',
		];
		const url = new URL('https://www.federalregister.gov/api/v1/documents.json');
		url.searchParams.set('per_page', String(Math.min(LIMIT, 100)));
		url.searchParams.append('conditions[type][]', 'RULE');
		url.searchParams.set('order', 'newest');
		for (const field of fields) url.searchParams.append('fields[]', field);
		const page = await json<{ results: FrDoc[] }>(url.toString());
		const docs: Doc[] = [];
		for (const rule of page.results) {
			const raw = await text(rule.raw_text_url);
			const pre = /<pre>([\s\S]*?)<\/pre>/.exec(raw)?.[1] ?? raw;
			const cfr = (rule.cfr_references ?? [])
				.map((r) => `${r.title} CFR ${r.part ?? ''}`.trim())
				.join(', ');
			docs.push({
				key: `federal/fr/${rule.document_number}.md`,
				title: rule.title,
				jurisdiction: 'Federal',
				level: 'federal',
				citation: rule.citation ?? `FR Doc. ${rule.document_number}`,
				sourceUrl: rule.html_url,
				authors: '',
				issuingBody: (rule.agency_names ?? []).join('; '),
				body: [
					`# ${rule.title}`,
					'',
					`**Published:** ${rule.publication_date}` +
						(rule.effective_on ? `  **Effective:** ${rule.effective_on}` : '') +
						(cfr ? `  **Amends:** ${cfr}` : ''),
					'',
					rule.abstract ? `> ${rule.abstract}\n` : '',
					'```text',
					decodeEntities(pre.replace(/<[^>]+>/g, '')).trim(),
					'```',
				].join('\n'),
			});
		}
		return docs;
	},

	// California statutes from the Legislature's leginfo site. Government Code
	// title 2, division 3, part 1, chapter 3.5 is the California APA.
	async ca() {
		const CODE = 'GOV';
		const base = 'https://leginfo.legislature.ca.gov/faces';
		const numbers = new Set<string>();
		for (const article of ['1.', '2.', '3.', '4.', '5.', '6.', '7.', '8.']) {
			const listing = await text(
				`${base}/codes_displayText.xhtml?lawCode=${CODE}&division=3.&title=2.&part=1.&chapter=3.5.&article=${article}`,
			);
			for (const match of listing.matchAll(/submitCodesValues\('([\d.]+)'/g)) numbers.add(match[1]);
		}
		const docs: Doc[] = [];
		for (const number of [...numbers].slice(0, LIMIT)) {
			const url = `${base}/codes_displaySection.xhtml?lawCode=${CODE}&sectionNum=${number}`;
			const html = await text(url);
			const section = /<div id="codeLawSectionNoHead"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/.exec(html)?.[1];
			if (!section) continue;
			// The section div leads with the code hierarchy as a run of headings
			// (each followed by an enactment note), then the numbered section.
			const lines = htmlToMarkdown(section).split('\n');
			const start = lines.findIndex((line) => line.startsWith(`### ${number}`));
			const heading = lines
				.slice(0, Math.max(start, 0))
				.filter((line) => /^### (TITLE|DIVISION|PART|CHAPTER|ARTICLE)\b/.test(line))
				.map((line) => line.slice(4).replace(/\s*\[[\d.\s-]+\]$/, ''))
				.join(' › ');
			const num = number.replace(/\.$/, '');
			docs.push({
				key: `california/gov/gov-${num}.md`,
				title: `Cal. Gov. Code § ${num}`,
				jurisdiction: 'California',
				level: 'state',
				citation: `Cal. Gov. Code § ${num}`,
				sourceUrl: url,
				authors: '',
				issuingBody: 'California State Legislature',
				body: [
					`# Government Code § ${num}`,
					'',
					heading ? `*${heading}*\n` : '',
					lines.slice(start + 1).join('\n'),
				].join('\n'),
			});
		}
		return docs;
	},

	// County and municipal codes hosted on Municode (undocumented JSON API used
	// by library.municode.com). One county and one city; each walks the first
	// articles/chapters of the code down to section-level documents.
	async municode() {
		const CODES = [
			{
				clientId: 11719,
				jurisdiction: 'Miami-Dade County, Florida',
				level: 'county',
				issuingBody: 'Miami-Dade County Board of County Commissioners',
				cite: 'Miami-Dade County Code',
				slug: 'miami-dade-county-fl',
			},
			{
				clientId: 3637,
				jurisdiction: 'Oakland, California',
				level: 'municipal',
				issuingBody: 'Oakland City Council',
				cite: 'Oakland Municipal Code',
				slug: 'oakland-ca',
			},
		];
		const api = 'https://api.municode.com';
		const docs: Doc[] = [];
		for (const code of CODES) {
			const content = await json<{ codes: { productId: number; productName: string }[] }>(
				`${api}/ClientContent/${code.clientId}`,
			);
			const product = content.codes.find((c) => /code of ordinances|municipal code|code/i.test(c.productName));
			if (!product) continue;
			const job = await json<{ Id: number }>(`${api}/Jobs/latest/${product.productId}`);
			const toc = await json<{ Children: TocNode[] }>(
				`${api}/codesToc?jobId=${job.Id}&productId=${product.productId}`,
			);
			// Depth-first through the TOC, collecting leaf-ish nodes whose content
			// call returns section documents, until this code's share of LIMIT.
			const budget = Math.ceil(LIMIT / CODES.length);
			const queue = toc.Children.filter((n) => n.HasChildren);
			while (queue.length && docs.filter((d) => d.jurisdiction === code.jurisdiction).length < budget) {
				const node = queue.shift()!;
				const children = await json<TocNode[]>(
					`${api}/codesToc/children?jobId=${job.Id}&nodeId=${node.Id}&productId=${product.productId}`,
				);
				const branches = children.filter((c) => c.HasChildren);
				if (branches.length) {
					queue.unshift(...branches);
					continue;
				}
				const page = await json<{ Docs: MunicodeDoc[] }>(
					`${api}/CodesContent?jobId=${job.Id}&nodeId=${node.Id}&productId=${product.productId}`,
				);
				// Docs are in reading order with mixed depths, so the ancestry of a
				// section is the latest title seen at each shallower depth.
				const ancestors: string[] = [];
				for (const section of page.Docs) {
					ancestors.length = section.NodeDepth;
					ancestors[section.NodeDepth - 1] = section.Title;
					if (section.NodeDepth < 3 || section.Content.length <= 80) continue;
					if (docs.filter((d) => d.jurisdiction === code.jurisdiction).length >= budget) break;
					const context = ancestors.slice(0, section.NodeDepth - 1).join(' › ');
					const number = /^(?:sec(?:tion)?\.?\s*)?([\dA-Z.-]+?)\.?\s*-\s/i.exec(section.Title)?.[1];
					docs.push({
						key: `${code.level}/${code.slug}/${section.Id.toLowerCase()}.md`,
						title: `${code.cite} ${section.Title.replace(/\s*-\s*/, ' — ')}`,
						jurisdiction: code.jurisdiction,
						level: code.level,
						citation: number ? `${code.cite} § ${number}` : code.cite,
						sourceUrl: `https://library.municode.com/${code.slug.replace(/-[a-z]{2}$/, '')}/codes/code_of_ordinances?nodeId=${section.Id}`,
						authors: '',
						issuingBody: code.issuingBody,
						body: [`# ${section.Title}`, '', `*${context}*`, '', htmlToMarkdown(section.Content)].join('\n'),
					});
				}
			}
		}
		return docs;
	},
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const selected = Object.entries(SOURCES).filter(([name]) => !ONLY || ONLY.includes(name));
for (const [name, fetchDocs] of selected) {
	process.stdout.write(`[${name}] fetching…`);
	const docs = await fetchDocs();
	console.log(` ${docs.length} documents`);
	for (const doc of docs) {
		const file = path.join(OUT_DIR, doc.key);
		await mkdir(path.dirname(file), { recursive: true });
		await writeFile(file, render(doc));
		if (!UPLOAD) continue;
		const response = await fetch(`${SEED_URL}/api/documents/${doc.key}`, {
			method: 'PUT',
			headers: { authorization: `Bearer ${SEED_TOKEN}`, 'content-type': 'text/markdown' },
			body: render(doc),
		});
		if (!response.ok) throw new Error(`upload failed ${response.status} ${doc.key}: ${await response.text()}`);
		console.log(`  ↑ ${doc.key}`);
	}
}
console.log(UPLOAD ? '\nDone. Now run: npx wrangler ai-search jobs create government-regulation-agent' : `\nWrote files to ${OUT_DIR}. Re-run with --upload to push them to R2.`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function render(doc: Doc) {
	const quote = (value: string) => JSON.stringify(value);
	return [
		'---',
		`title: ${quote(doc.title)}`,
		`jurisdiction: ${quote(doc.jurisdiction)}`,
		`level: ${quote(doc.level)}`,
		`citation: ${quote(doc.citation)}`,
		`sourceUrl: ${quote(doc.sourceUrl)}`,
		`authors: ${quote(doc.authors)}`,
		`issuingBody: ${quote(doc.issuingBody)}`,
		'---',
		'',
		doc.body.trim(),
		'',
	].join('\n');
}

async function readEnvToken() {
	const env = await readFile('.env', 'utf8').catch(() => '');
	return /^SEED_TOKEN=["']?([^"'\n]+)/m.exec(env)?.[1];
}

async function ecfrDate() {
	if (cachedEcfrDate) return cachedEcfrDate;
	const titles = await json<{ titles: { number: number; up_to_date_as_of: string }[] }>(
		'https://www.ecfr.gov/api/versioner/v1/titles.json',
	);
	cachedEcfrDate = titles.titles.reduce((min, t) => (t.up_to_date_as_of < min ? t.up_to_date_as_of : min), '9999');
	return cachedEcfrDate;
}


async function text(url: string) {
	const response = await fetch(url, { headers: HEADERS });
	if (!response.ok) throw new Error(`${response.status} ${url}`);
	return response.text();
}

async function json<T>(url: string): Promise<T> {
	const response = await fetch(url, { headers: HEADERS });
	if (!response.ok) throw new Error(`${response.status} ${url}`);
	return response.json() as Promise<T>;
}

// Small, dependency-free HTML/XML to Markdown: block tags become paragraphs
// or headings, inline emphasis is kept, everything else is stripped.
function htmlToMarkdown(html: string) {
	const out = html
		.replace(/<\?xml[^>]*>/g, '')
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<h1[^>]*>/gi, '\n# ')
		.replace(/<h2[^>]*>/gi, '\n## ')
		.replace(/<h[3-6][^>]*>/gi, '\n### ')
		.replace(/<\/h[1-6]>/gi, '\n\n')
		.replace(/<(?:i|em)\b[^>]*>/gi, '*')
		.replace(/<\/(?:i|em)>/gi, '*')
		.replace(/<(?:b|strong)\b[^>]*>/gi, '**')
		.replace(/<\/(?:b|strong)>/gi, '**')
		.replace(/<li[^>]*>/gi, '\n- ')
		.replace(/<\/?(?:p|div|tr|ul|ol|table|blockquote|section|extract|fp|note|cita|xref)\b[^>]*>/gi, '\n\n')
		.replace(/<\/?t[dh]\b[^>]*>/gi, ' ')
		.replace(/<[^>]+>/g, '');
	return decodeEntities(out)
		.replace(/\*\s*\*/g, '')
		.replace(/[ \t]+/g, ' ')
		.replace(/ *\n */g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function decodeEntities(value: string) {
	const named: Record<string, string> = {
		amp: '&',
		lt: '<',
		gt: '>',
		quot: '"',
		apos: "'",
		nbsp: ' ',
		sect: '§',
		mdash: '—',
		ndash: '–',
		para: '¶',
		ldquo: '“',
		rdquo: '”',
		lsquo: '‘',
		rsquo: '’',
	};
	return value
		.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
		.replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match);
}

interface EcfrNode {
	type: string;
	identifier: string;
	label: string;
	label_description: string;
	reserved?: boolean;
	children?: EcfrNode[];
}

function findPath(
	node: EcfrNode,
	predicate: (n: EcfrNode) => boolean,
	path: EcfrNode[] = [],
): { node: EcfrNode; path: EcfrNode[] } | undefined {
	if (predicate(node)) return { node, path };
	for (const child of node.children ?? []) {
		const found = findPath(child, predicate, [...path, node]);
		if (found) return found;
	}
	return undefined;
}

function collect(node: EcfrNode, predicate: (n: EcfrNode) => boolean): EcfrNode[] {
	return [...(predicate(node) ? [node] : []), ...(node.children ?? []).flatMap((c) => collect(c, predicate))];
}

interface FrDoc {
	title: string;
	document_number: string;
	citation?: string;
	publication_date: string;
	effective_on?: string;
	agency_names?: string[];
	cfr_references?: { title: number; part?: string }[];
	abstract?: string;
	html_url: string;
	raw_text_url: string;
}

interface TocNode {
	Id: string;
	Heading: string;
	HasChildren: boolean;
}

interface MunicodeDoc {
	Id: string;
	Title: string;
	NodeDepth: number;
	Content: string;
}
