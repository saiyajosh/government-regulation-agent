// Seed the R2 document library from official, public-domain sources.
//
//   node scripts/seed.ts                       # sample: ~40 docs per source, no upload
//   node scripts/seed.ts --upload              # also upload through the running app
//   node scripts/seed.ts --only ecfr,ca        # subset of sources (see SOURCES)
//   node scripts/seed.ts --limit 0             # no per-source cap (0 = unlimited)
//   node scripts/seed.ts --full --limit 0 --upload --skip-existing
//
// Sample mode (default) pulls a few well-known parts, chapters, and codes.
// --full walks whole titles and codes instead:
//   --cfr-titles 1,5        every section of those CFR titles (eCFR)
//   --usc-titles 5          every section of those U.S. Code titles (USLM XML)
//   --fr-since 2026-01-01   every final rule published since that date
//   --ca-codes GOV,CIV      every section of those California codes (all = all 30)
//   --municode-state CA     every city on Municode in that state (counties too
//                           with --municode-counties)
//
// --profile ghg ignores the flags above and seeds a curated greenhouse-gas
// corpus (federal, California, Bay Area) defined in PROFILES below, adding
// the ccr, baaqmd, and municodeSearch sources.
//
// Every document is one citable unit (a statute section, a CFR section, a
// Federal Register rule, a code section) written as Markdown with frontmatter.
// Uploads go through the app's PUT /api/documents/:key route (Wrangler cannot
// set the R2 custom metadata AI Search filters on), so run `pnpm dev` first
// and set SEED_TOKEN in .env; SEED_URL overrides http://localhost:5173.
// --skip-existing makes re-runs resumable. Afterwards, trigger an index sync:
//   npx wrangler ai-search jobs create government-regulation-agent
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SEED_URL = process.env.SEED_URL ?? 'http://localhost:5173';

const OUT_DIR = path.resolve('seed/documents');

const args = process.argv.slice(2);

const flag = (name: string) => {
	const index = args.indexOf(`--${name}`);

	return index === -1 ? undefined : (args[index + 1] ?? '');
};

const UPLOAD = args.includes('--upload');

const FULL = args.includes('--full');

const SKIP_EXISTING = args.includes('--skip-existing');

const LIMIT = Number(flag('limit') ?? (FULL ? 0 : 40)) || Infinity;

const CONCURRENCY = Number(flag('concurrency') ?? 6);

const ONLY = flag('only')?.split(',').filter(Boolean);

const CFR_TITLES = (flag('cfr-titles') ?? '5').split(',').map(Number);

const USC_TITLES = (flag('usc-titles') ?? '5').split(',');

const FR_SINCE = flag('fr-since');

const CA_CODES = (flag('ca-codes') ?? 'GOV').split(',');

const MUNICODE_STATE = flag('municode-state') ?? 'CA';

const MUNICODE_COUNTIES = args.includes('--municode-counties');

const PROFILE = flag('profile');

// Declared before any top-level await so the helpers below can see them.
const HEADERS = {
	'User-Agent': 'government-regulation-agent-seed/1.0',
	Accept: 'application/json, text/xml, text/html, */*',
};

let cachedEcfrDate: string | undefined;

const SEED_TOKEN = process.env.SEED_TOKEN ?? (await readEnvToken());

if (UPLOAD && !SEED_TOKEN) throw new Error('--upload needs SEED_TOKEN in the environment or .env');

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
	// When set, the PDF is uploaded instead of `body` and converted server-side.
	pdfUrl?: string;
}

// Each source pushes documents as it finds them so uploads overlap with
// fetching and a crash keeps what was already stored.
type Emit = (doc: Doc) => Promise<void>;

// Curated corpora. Section counts are from the live sources as of Sept 2026.
const PROFILES = {
	ghg: {
		// Whole CFR parts: EPA stationary and mobile source programs, GHG
		// reporting, fuels, DOE appliance efficiency, NHTSA fuel economy, BLM
		// methane waste prevention. ~8,500 sections.
		cfrParts: [
			...[52, 60, 63, 70, 71, 72, 73, 74, 75, 76, 77, 78, 80, 86, 87, 97, 98, 600, 1036, 1037, 1039, 1042, 1043, 1045, 1048, 1051, 1054, 1060, 1065, 1066, 1068, 1074, 1090].map((part) => ({ title: 40, part: String(part) })),
			...[429, 430, 431].map((part) => ({ title: 10, part: String(part) })),
			...[531, 533, 535, 536, 537, 538].map((part) => ({ title: 49, part: String(part) })),
			{ title: 30, part: '3179' },
		],
		// Clean Air Act, EPCA appliance standards, CAFE, and the IRA/IRC clean
		// energy credits.
		uscRanges: [
			{ title: '42', from: 7401, to: 7671 },
			{ title: '42', from: 6291, to: 6317 },
			{ title: '49', from: 32901, to: 32919 },
			{ title: '26', list: ['25C', '25D', '30C', '30D', '45L', '45Q', '45U', '45V', '45W', '45X', '45Y', '45Z', '48', '48C', '48E', '179D'] },
		],
		frQueries: [
			...['"greenhouse gas"', '"carbon dioxide"', 'methane', '"fuel economy"', '"energy conservation standards"'].map((term) => ({ term, type: 'RULE', since: '2020-01-01' })),
			...['"greenhouse gas"', '"carbon dioxide"', 'methane', '"fuel economy"'].map((term) => ({ term, type: 'PRORULE', since: '2024-01-01' })),
		],
		// leginfo branches: AB 32 and successors, CARB and vehicle parts of the
		// air resources division, the renewables portfolio standard.
		caPaths: [
			{ code: 'HSC', match: { division: '25.5.' } },
			{ code: 'HSC', match: { division: '26.', part: '1.' } },
			{ code: 'HSC', match: { division: '26.', part: '2.' } },
			{ code: 'HSC', match: { division: '26.', part: '5.' } },
			{ code: 'PUC', match: { division: '1.', part: '1.', chapter: '2.3.', article: '16.' } },
		],
		// Individual sections outside those branches (SB 100, SB 375, CEQA GHG,
		// energy commission climate duties). Unknown numbers are skipped.
		caSections: [
			{ code: 'PUC', sections: ['399.11', '399.12', '399.13', '399.15', '399.30', '454.51', '454.52', '454.53', '454.54', '8360', '8380'] },
			{ code: 'GOV', sections: ['65080', '65080.01', '65080.1', '65080.3'] },
			{ code: 'PRC', sections: ['21083.05', '21099', '21155', '21155.1', '25000.5', '25302', '25310', '25327', '25711.5', '25943'] },
		],
		// Cornell LII mirrors the CCR; robots.txt asks for a 10 s crawl delay.
		ccrStarts: [
			'/regulations/california/title-17/division-3/chapter-1/subchapter-10',
			'/regulations/california/title-13/division-3/chapter-1',
		],
		baaqmdRules: /Regulation-13|12-Rule-15|12-Rule-16|Regulation-2-Rule-2|Reg-2-Rule-2|9-Rule-10|Regulation-6-Rule-5/i,
		municodeSearch: {
			clients: [
				{ id: 3637, name: 'Oakland', state: 'California', abbr: 'CA' },
				{ id: 4205, name: 'San Jose', state: 'California', abbr: 'CA' },
			],
			terms: ['greenhouse gas', 'climate', 'natural gas', 'electric vehicle', 'energy efficiency', 'emissions', 'all-electric', 'solar', 'building electrification'],
		},
	},
};

const GHG = PROFILE === 'ghg' ? PROFILES.ghg : undefined;

if (PROFILE && !GHG) throw new Error(`Unknown profile "${PROFILE}"`);

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

const SOURCES = {
	// Code of Federal Regulations via the eCFR versioner API. One request per
	// part returns every section as a DIV8 element; the hierarchy names the
	// issuing agency (chapter) and the citation.
	async ecfr(emit) {
		const SAMPLE_PARTS = [
			{ title: 5, part: '2635' }, // OGE Standards of Ethical Conduct
			{ title: 5, part: '1201' }, // MSPB Practices and Procedures
			{ title: 1, part: '51' }, // Incorporation by reference (OFR)
		];

		const date = await ecfrDate();
		const wanted = GHG ? GHG.cfrParts : FULL ? undefined : SAMPLE_PARTS;
		const titles = wanted ? [...new Set(wanted.map((p) => p.title))] : CFR_TITLES;
		let count = 0;

		for (const title of titles) {
			const structure = await json<EcfrNode>(
				`https://www.ecfr.gov/api/versioner/v1/structure/current/title-${title}.json`,
			);

			const parts = collectWithPath(structure, (n) => n.type === 'part' && !n.reserved).filter(
				({ node }) => !wanted || wanted.some((p) => p.title === title && p.part === node.identifier),
			);

			for (const { node: part, path: ancestors } of parts) {
				if (count >= LIMIT) return;
				const agency = ancestors.find((n) => n.type === 'chapter')?.label_description ?? '';

				const xml = await text(
					`https://www.ecfr.gov/api/versioner/v1/full/${date}/title-${title}.xml?part=${part.identifier}`,
				).catch(() => '');

				for (const match of xml.matchAll(/<DIV8 N="([^"]+)" TYPE="SECTION"[^>]*>([\s\S]*?)<\/DIV8>/g)) {
					if (count >= LIMIT) return;
					const [, identifier, inner] = match;
					const heading = htmlToMarkdown(/<HEAD>([\s\S]*?)<\/HEAD>/.exec(inner)?.[1] ?? identifier);

					if (/\[Reserved\]/i.test(heading)) continue;
					count += 1;
					await emit({
						key: `federal/cfr/${title}-cfr-${identifier}.md`,
						title: `${title} CFR ${identifier} — ${heading.replace(/^§\s*[\d.]+[a-z-]*\s*/i, '')}`,
						jurisdiction: 'Federal',
						level: 'federal',
						citation: `${title} CFR § ${identifier}`,
						sourceUrl: `https://www.ecfr.gov/current/title-${title}/section-${identifier}`,
						authors: '',
						issuingBody: agency,
						body: htmlToMarkdown(inner.replace(/<HEAD>/g, '<h2>').replace(/<\/HEAD>/g, '</h2>')),
					});
				}
			}
		}
	},

	// United States Code from the Office of the Law Revision Counsel's USLM XML
	// release points (one zip per title). In sample mode only Title 5 chapter 5
	// subchapter II (the Administrative Procedure Act) is kept.
	async uscode(emit) {
		const download = await text('https://uscode.house.gov/download/download.shtml');
		let count = 0;
		const ranges = GHG?.uscRanges;
		const titles = ranges ? [...new Set(ranges.map((r) => r.title))] : USC_TITLES;

		for (const title of titles) {
			const padded = title.padStart(2, '0');
			const zipPath = new RegExp(`releasepoints/us/pl/\\d+/\\d+/xml_usc${padded}@[\\d-]+\\.zip`).exec(download)?.[0];

			if (!zipPath) throw new Error(`No USLM release found for title ${title}`);
			const dir = await mkdtemp(path.join(tmpdir(), 'usc-'));
			const zip = path.join(dir, 'title.zip');
			const archive = await request(`https://uscode.house.gov/download/${zipPath}`);
			await writeFile(zip, Buffer.from(await archive.arrayBuffer()));
			execFileSync('unzip', ['-o', '-q', zip, '-d', dir]);
			const xmlFile = (await readdir(dir)).find((f) => f.endsWith('.xml'));
			const xml = await readFile(path.join(dir, xmlFile!), 'utf8');

			for (const match of xml.matchAll(/<section\b[^>]*identifier="\/us\/usc\/t\w+\/s([^"]+)"[^>]*>([\s\S]*?)<\/section>/g)) {
				if (count >= LIMIT) return;
				const [, section, inner] = match;

				if (ranges) {
					const numeric = Number(/^\d+/.exec(section)?.[0]);

					const inRange = ranges.some(
						(r) => r.title === title && ('list' in r ? r.list.includes(section) : numeric >= r.from && numeric <= r.to),
					);

					if (!inRange) continue;
				} else if (!FULL && !/^55[1-9]/.test(section)) continue;
				const num = /<num[^>]*>([\s\S]*?)<\/num>/.exec(inner)?.[1] ?? `§ ${section}`;
				const heading = /<heading[^>]*>([\s\S]*?)<\/heading>/.exec(inner)?.[1] ?? '';

				if (/repealed|reserved|omitted/i.test(heading) && inner.length < 600) continue;
				count += 1;
				await emit({
					key: `federal/usc/${title}-usc-${section}.md`,
					title: `${title} U.S.C. ${htmlToMarkdown(num).trim()} ${htmlToMarkdown(heading).trim()}`.trim(),
					jurisdiction: 'Federal',
					level: 'federal',
					citation: `${title} U.S.C. § ${section}`,
					sourceUrl: `https://uscode.house.gov/view.xhtml?req=granuleid:USC-prelim-title${title}-section${section}&num=0&edition=prelim`,
					authors: '',
					issuingBody: 'United States Congress',
					body: htmlToMarkdown(
						inner
							.replace(/<num[^>]*>([\s\S]*?)<\/num>\s*<heading[^>]*>([\s\S]*?)<\/heading>/, '<h2>$1 $2</h2>')
							.replace(/<sourceCredit>/g, '<p><i>')
							.replace(/<\/sourceCredit>/g, '</i></p>')
							.replace(/<notes>[\s\S]*$/, ''),
					),
				});
			}
		}
	},

	// Final rules from the Federal Register API (most recent first) with the
	// GPO plain-text body. Agencies become the issuing body.
	async federalRegister(emit) {
		const fields = ['title', 'document_number', 'citation', 'publication_date', 'effective_on', 'agency_names', 'cfr_references', 'abstract', 'html_url', 'raw_text_url'];
		const queries = GHG?.frQueries ?? [{ term: undefined, type: 'RULE', since: FR_SINCE }];
		const seen = new Set<string>();
		let count = 0;

		for (const query of queries) {
			const first = new URL('https://www.federalregister.gov/api/v1/documents.json');
			first.searchParams.set('per_page', '100');
			first.searchParams.append('conditions[type][]', query.type);
			first.searchParams.set('order', 'newest');

			if (query.term) first.searchParams.set('conditions[term]', query.term);

			if (query.since) first.searchParams.set('conditions[publication_date][gte]', query.since);

			for (const field of fields) first.searchParams.append('fields[]', field);
			let next: string | undefined = first.toString();

			while (next && count < LIMIT) {
			const page: { results: FrDoc[]; next_page_url?: string } = await json(next);
			next = page.next_page_url;

			for (const rule of page.results) {
				if (count >= LIMIT) return;

				if (seen.has(rule.document_number)) continue;
				seen.add(rule.document_number);
				const raw = await text(rule.raw_text_url).catch(() => '');

				if (!raw) {
					console.error(`  ✗ ${rule.document_number}: empty or failed raw text fetch`);
					continue;
				}

				count += 1;
				const pre = /<pre>([\s\S]*?)<\/pre>/.exec(raw)?.[1] ?? raw;
				const cfr = (rule.cfr_references ?? []).map((r) => `${r.title} CFR ${r.part ?? ''}`.trim()).join(', ');
				await emit({
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
						`**${query.type === 'PRORULE' ? 'Proposed rule, published' : 'Final rule, published'}:** ${rule.publication_date}` +
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
			}
		}
	},

	// California statutes from the Legislature's leginfo site. The TOC is
	// crawled through its "expanded branch" pages down to leaf branches, whose
	// text pages carry every section of that chapter or article in one
	// response. Sample mode covers Government Code chapter 3.5 (the CA APA).
	async ca(emit) {
		const base = 'https://leginfo.legislature.ca.gov/faces';

		const codes = GHG
			? [...new Set(GHG.caPaths.map((p) => p.code))]
			: !FULL
				? ['GOV']
				: CA_CODES.includes('all')
					? [...new Set([...(await text(`${base}/codes.xhtml`)).matchAll(/tocCode=([A-Z]+)/g)].map((m) => m[1]))]
					: CA_CODES;

		let count = 0;
		const seen = new Set<string>();

		for (const code of codes) {
			const leaves = GHG
				? (await Promise.all(GHG.caPaths.filter((p) => p.code === code).map((p) => caLeafPages(base, code, p.match)))).flat()
				: FULL
					? await caLeafPages(base, code)
					: [`${base}/codes_displayText.xhtml?lawCode=GOV&division=3.&title=2.&part=1.&chapter=3.5.`];

			for (const leaf of leaves) {
				if (count >= LIMIT) return;
				const page = await text(leaf).catch(() => '');
				const codeName = decodeEntities(new RegExp(`<b>([^<]+?) - ${code}</b>`).exec(page)?.[1] ?? code);
				// A page holds several sections under interleaved hierarchy headings,
				// so each section's breadcrumb is the latest heading seen per rank.
				const [preamble, ...chunks] = page.split(`<h6 style="float:left;"><a href="javascript:submitCodesValues('`);
				const ranks = new Map<string, string>();

				const noteHeadings = (html: string) => {
					for (const m of html.matchAll(/<h[1-6][^>]*>\s*<b>\s*([^<]+?)\s*<\/b>/g)) {
						const heading = decodeEntities(m[1]).replace(/\s*\[[\d.\s-]+\]$/, '').trim();
						const rank = /^(TITLE|DIVISION|PART|CHAPTER|ARTICLE)\b/.exec(heading)?.[1];

						if (rank) ranks.set(rank, heading);
					}
				};

				noteHeadings(preamble);

				for (const chunk of chunks) {
					if (count >= LIMIT) return;
					const number = /^([\d.]+?)\.?'/.exec(chunk)?.[1];
					const bodyStart = chunk.indexOf('</h6>') + 5;
					const bodyHtml = chunk.slice(bodyStart).split('<div align="left">')[0];
					const crumbs = ['TITLE', 'DIVISION', 'PART', 'CHAPTER', 'ARTICLE'].flatMap((r) => ranks.get(r) ?? []);
					noteHeadings(chunk.slice(bodyStart + bodyHtml.length));

					if (!number || seen.has(`${code}:${number}`)) continue;
					seen.add(`${code}:${number}`);
					count += 1;
					await emit({
						key: `california/${code.toLowerCase()}/${code.toLowerCase()}-${number}.md`,
						title: `Cal. ${caShort(codeName, code)} § ${number}`,
						jurisdiction: 'California',
						level: 'state',
						citation: `Cal. ${caShort(codeName, code)} § ${number}`,
						sourceUrl: `${base}/codes_displaySection.xhtml?lawCode=${code}&sectionNum=${number}.`,
						authors: '',
						issuingBody: 'California State Legislature',
						body: [`# ${codeName} § ${number}`, '', crumbs.length ? `*${crumbs.join(' › ')}*\n` : '', htmlToMarkdown(bodyHtml)].join('\n'),
					});
				}
			}
		}

		// Individually listed sections, fetched one page each.
		for (const { code, sections } of GHG?.caSections ?? []) {
			for (const number of sections) {
				if (count >= LIMIT || seen.has(`${code}:${number}`)) continue;
				const url = `${base}/codes_displaySection.xhtml?lawCode=${code}&sectionNum=${number}.`;
				const html = await text(url).catch(() => '');
				const section = /<div id="codeLawSectionNoHead"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/.exec(html)?.[1];

				if (!section) continue;
				const codeName = decodeEntities(new RegExp(`<b>([^<]+?) - ${code}</b>`).exec(html)?.[1] ?? code);
				const lines = htmlToMarkdown(section).split('\n');
				const start = lines.findIndex((line) => line.startsWith(`### ${number}`));

				const crumbs = lines
					.slice(0, Math.max(start, 0))
					.filter((line) => /^### (TITLE|DIVISION|PART|CHAPTER|ARTICLE)\b/.test(line))
					.map((line) => line.slice(4).replace(/\s*\[[\d.\s-]+\]$/, ''));

				seen.add(`${code}:${number}`);
				count += 1;
				await emit({
					key: `california/${code.toLowerCase()}/${code.toLowerCase()}-${number}.md`,
					title: `Cal. ${caShort(codeName, code)} § ${number}`,
					jurisdiction: 'California',
					level: 'state',
					citation: `Cal. ${caShort(codeName, code)} § ${number}`,
					sourceUrl: url,
					authors: '',
					issuingBody: 'California State Legislature',
					body: [`# ${codeName} § ${number}`, '', crumbs.length ? `*${crumbs.join(' › ')}*\n` : '', lines.slice(start + 1).join('\n')].join('\n'),
				});
			}
		}
	},

	// California Code of Regulations via Cornell LII's mirror (the official
	// host is a JavaScript app with no API). Crawls from each start page down
	// through articles and subarticles to section pages, one request every
	// 10 seconds as its robots.txt asks. Profile only.
	async ccr(emit) {
		if (!GHG) return console.log('  ccr runs only with --profile ghg');
		const base = 'https://www.law.cornell.edu';
		const pause = () => new Promise((resolve) => setTimeout(resolve, 10_000));
		let count = 0;

		for (const start of GHG.ccrStarts) {
			const queue = [start];
			const seen = new Set<string>();
			const sections = new Set<string>();

			while (queue.length) {
				const url = queue.shift()!;

				if (seen.has(url)) continue;
				seen.add(url);
				await pause();
				const page = await text(`${base}${url}`).catch(() => '');

				for (const m of page.matchAll(/href="(\/regulations\/california\/[^"]+)"/g)) {
					const href = m[1];

					if (/^\/regulations\/california\/\d+-CCR-/.test(href)) sections.add(href);
					else if (href.startsWith(`${url}/`) && !seen.has(href)) queue.push(href);
				}
			}

			for (const href of sections) {
				if (count >= LIMIT) return;
				await pause();
				const page = await text(`${base}${href}`).catch(() => '');
				const heading = decodeEntities(/<title>([^<]*?)\s*\|/.exec(page)?.[1] ?? href);
				const [, ccrTitle, section] = /Tit\.\s*(\d+),\s*§\s*([\d.]+)/.exec(heading) ?? [];

				const body = /<div[^>]*class="[^"]*statereg-text[^"]*"[^>]*>([\s\S]*?)<div[^>]*class="[^"]*statereg-notes/.exec(page)?.[1]
					?? /<div[^>]*class="[^"]*statereg-text[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/.exec(page)?.[1];

				if (!ccrTitle || !section || !body) continue;

				const crumbs = [...page.matchAll(/<div id="breadcrumb"[\s\S]*?<\/div>/g)]
					.flatMap((m) => [...m[0].matchAll(/>([^<]{3,120})<\/a>/g)].map((x) => decodeEntities(x[1]).trim()))
					.filter((c) => /^(Title|Division|Chapter|Subchapter|Article|Subarticle)\b/i.test(c));

				count += 1;
				await emit({
					key: `california/ccr/${ccrTitle}-ccr-${section}.md`,
					title: heading,
					jurisdiction: 'California',
					level: 'state',
					citation: `Cal. Code Regs. tit. ${ccrTitle}, § ${section}`,
					sourceUrl: `${base}${href}`,
					authors: '',
					issuingBody: 'California Air Resources Board',
					body: [`# ${heading}`, '', crumbs.length ? `*${crumbs.join(' › ')}*\n` : '', htmlToMarkdown(body)].join('\n'),
				});
			}
		}
	},

	// Bay Area Air Quality Management District rules, published as PDFs on
	// rule pages. The ingest route converts PDFs to Markdown. Profile only.
	async baaqmd(emit) {
		if (!GHG) return console.log('  baaqmd runs only with --profile ghg');
		const base = 'https://www.baaqmd.gov';
		const index = await text(`${base}/rules-and-compliance/current-rules`);
		const pages = [...new Set([...index.matchAll(/href="(\/en\/Rules-and-Compliance\/Rules\/[^"]+)"/g)].map((m) => decodeEntities(m[1]).replace(/\?.*$/, '')))].filter((href) => GHG.baaqmdRules.test(href));
		let count = 0;

		for (const href of pages) {
			if (count >= LIMIT) return;
			const page = await text(`${base}${href}`).catch(() => '');
			const title = decodeEntities(/<title>([^<]*)<\/title>/.exec(page)?.[1] ?? href).trim();

			// Prefer the adopted rule text over draft and workshop versions.
			const links = [...page.matchAll(/<a[^>]*href="([^"]*\.pdf[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => ({
				href: decodeEntities(m[1]),
				label: m[2].replace(/<[^>]+>/g, '').trim(),
			}));

			const pdf = links.find((l) => !/draft|workshop|staff report|appendix/i.test(l.label)) ?? links[0];

			if (!pdf) continue;
			const rule = /Regulation\s*(\d+)(?:,?\s*Rule\s*(\d+))?/i.exec(title);
			const citation = rule ? `BAAQMD Reg. ${rule[1]}${rule[2] ? `-${rule[2]}` : ''}` : 'BAAQMD Rule';
			count += 1;
			await emit({
				// The citation regex can miss, so key on the page slug, which is unique.
				key: `regional/baaqmd/${href.split('/').filter(Boolean).at(-1)!.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`,
				title,
				jurisdiction: 'Bay Area',
				level: 'regional',
				citation,
				sourceUrl: `${base}${href}`,
				authors: '',
				issuingBody: 'Bay Area Air Quality Management District',
				body: '',
				pdfUrl: pdf.href.startsWith('http') ? pdf.href : `${base}${pdf.href}`,
			});
		}
	},

	// Municipal code sections found by Municode's full-text search for the
	// profile's terms, then fetched by node id. Profile only.
	async municodeSearch(emit) {
		if (!GHG) return console.log('  municodeSearch runs only with --profile ghg');
		const api = 'https://api.municode.com';
		let count = 0;

		for (const client of GHG.municodeSearch.clients) {
			const hits = new Map<string, MunicodeHit>();

			for (const term of GHG.municodeSearch.terms) {
				for (let pageNum = 1; pageNum < 20; pageNum += 1) {
					const page = await json<{ Hits: MunicodeHit[]; NumberOfHits: number }>(
						`${api}/search?clientId=${client.id}&searchText=${encodeURIComponent(term)}&pageNum=${pageNum}&pageSize=50&contentTypeId=CODES`,
					).catch(() => null);

					if (!page?.Hits.length) break;

					for (const hit of page.Hits) hits.set(hit.NodeId, hit);

					if (pageNum * 50 >= page.NumberOfHits) break;
				}
			}

			const jobs = new Map<string, number>();
			const slug = `${client.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${client.abbr.toLowerCase()}`;

			for (const hit of hits.values()) {
				if (count >= LIMIT) return;
				const productId = hit.Product.Id;

				if (!jobs.has(productId)) {
					const job = await json<{ Id: number }>(`${api}/Jobs/latest/${productId}`).catch(() => null);
					jobs.set(productId, job?.Id ?? 0);
				}

				const jobId = jobs.get(productId);

				if (!jobId) continue;
				const page = await json<{ Docs: MunicodeDoc[] }>(`${api}/CodesContent?jobId=${jobId}&nodeId=${hit.NodeId}&productId=${productId}`).catch(() => null);
				const section = page?.Docs.find((d) => d.Id === hit.NodeId);

				if (!section || section.Content.length <= 80) continue;
				const number = /^(?:sec(?:tion)?\.?\s*)?([\dA-Z.-]+?)\.?\s*-\s/i.exec(section.Title)?.[1];
				const cite = `${client.name} Municipal Code`;
				count += 1;
				await emit({
					key: `municipal/${slug}/${section.Id.toLowerCase()}.md`,
					title: `${cite} ${section.Title.replace(/\s*-\s*/, ' — ')}`,
					jurisdiction: `${client.name}, ${client.state}`,
					level: 'municipal',
					citation: number ? `${cite} § ${number}` : cite,
					sourceUrl: `https://library.municode.com/${client.abbr.toLowerCase()}/${slug.replace(/-[a-z]{2}$/, '')}/codes/code_of_ordinances?nodeId=${section.Id}`,
					authors: '',
					issuingBody: `${client.name} City Council`,
					body: [`# ${section.Title}`, '', `*${hit.Ancestors.slice(1).map((a) => a.Title).join(' › ')}*`, '', htmlToMarkdown(section.Content)].join('\n'),
				});
			}
		}
	},

	// County and municipal codes hosted on Municode (the undocumented JSON API
	// behind library.municode.com). Sample mode takes one county and one city;
	// --full walks every city in --municode-state. Each code's TOC is walked
	// depth-first to leaf nodes, whose content call returns section documents.
	async municode(emit) {
		const api = 'https://api.municode.com';

		const clients: MunicodeClient[] = FULL
			? (await json<MunicodeClient[]>(`${api}/Clients/stateabbr?stateAbbr=${MUNICODE_STATE}`)).filter(
					(c) => MUNICODE_COUNTIES || !/county/i.test(c.ClientName),
				)
			: [
					{ ClientID: 11719, ClientName: 'Miami-Dade County', State: { StateName: 'Florida', StateAbbreviation: 'FL' } },
					{ ClientID: 3637, ClientName: 'Oakland', State: { StateName: 'California', StateAbbreviation: 'CA' } },
				];

		const perClient = Math.ceil(LIMIT / clients.length);

		for (const client of clients) {
			const isCounty = /county/i.test(client.ClientName);
			const jurisdiction = `${client.ClientName}, ${client.State.StateName}`;
			const slug = `${client.ClientName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${client.State.StateAbbreviation.toLowerCase()}`;
			const cite = `${client.ClientName} ${isCounty ? 'Code' : 'Municipal Code'}`;
			const content = await json<{ codes: { productId: number; productName: string }[] }>(`${api}/ClientContent/${client.ClientID}`).catch(() => null);

			if (!content) continue;
			let count = 0;

			for (const product of content.codes) {
				if (count >= perClient) break;
				const job = await json<{ Id: number }>(`${api}/Jobs/latest/${product.productId}`).catch(() => null);

				if (!job?.Id) continue;
				const toc = await json<{ Children: TocNode[] }>(`${api}/codesToc?jobId=${job.Id}&productId=${product.productId}`).catch(() => null);

				if (!toc) continue;
				const queue = toc.Children.filter((n) => n.HasChildren);

				while (queue.length && count < perClient) {
					const node = queue.shift()!;
					const children = await json<TocNode[]>(`${api}/codesToc/children?jobId=${job.Id}&nodeId=${node.Id}&productId=${product.productId}`).catch(() => []);
					const branches = children.filter((c) => c.HasChildren);

					if (branches.length) {
						queue.unshift(...branches);
						continue;
					}

					const page = await json<{ Docs: MunicodeDoc[] }>(`${api}/CodesContent?jobId=${job.Id}&nodeId=${node.Id}&productId=${product.productId}`).catch(() => null);

					if (!page) continue;
					// Docs are in reading order with mixed depths, so the ancestry of a
					// section is the latest title seen at each shallower depth.
					const ancestors: string[] = [];

					for (const section of page.Docs) {
						ancestors.length = section.NodeDepth;
						ancestors[section.NodeDepth - 1] = section.Title;

						if (section.NodeDepth < 3 || section.Content.length <= 80) continue;

						if (count >= perClient) break;
						count += 1;
						const number = /^(?:sec(?:tion)?\.?\s*)?([\dA-Z.-]+?)\.?\s*-\s/i.exec(section.Title)?.[1];
						await emit({
							key: `${isCounty ? 'county' : 'municipal'}/${slug}/${section.Id.toLowerCase()}.md`,
							title: `${cite} ${section.Title.replace(/\s*-\s*/, ' — ')}`,
							jurisdiction,
							level: isCounty ? 'county' : 'municipal',
							citation: number ? `${cite} § ${number}` : cite,
							sourceUrl: `https://library.municode.com/${client.State.StateAbbreviation.toLowerCase()}/${slug.replace(/-[a-z]{2}$/, '')}/codes/code_of_ordinances?nodeId=${section.Id}`,
							authors: '',
							issuingBody: isCounty ? `${client.ClientName} Board of Supervisors` : `${client.ClientName} City Council`,
							body: [`# ${section.Title}`, '', `*${[product.productName, ...ancestors.slice(0, section.NodeDepth - 1)].join(' › ')}*`, '', htmlToMarkdown(section.Content)].join('\n'),
						});
					}
				}
			}
		}
	},
} satisfies Record<string, (emit: Emit) => Promise<void>>;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const selected = Object.entries(SOURCES).filter(([name]) => !ONLY || ONLY.includes(name));

const totals: Record<string, { written: number; uploaded: number; skipped: number; failed: number }> = {};

for (const [name, run] of selected) {
	const stats = { written: 0, uploaded: 0, skipped: 0, failed: 0 };
	totals[name] = stats;
	console.log(`[${name}] starting`);
	const inFlight = new Set<Promise<void>>();

	const emit: Emit = async (doc) => {
		const task = (async () => {
			const file = path.join(OUT_DIR, doc.key);
			await mkdir(path.dirname(file), { recursive: true });
			const pdf = doc.pdfUrl ? Buffer.from(await (await request(doc.pdfUrl)).arrayBuffer()) : null;
			await writeFile(pdf ? file.replace(/\.md$/, '.pdf') : file, pdf ?? render(doc));
			stats.written += 1;

			if (!UPLOAD) return;

			if (SKIP_EXISTING && (await fetch(`${SEED_URL}/api/documents/${doc.key}`, { method: 'HEAD' })).ok) {
				stats.skipped += 1;

				return;
			}

			const response = await fetch(`${SEED_URL}/api/documents/${doc.key}`, {
				method: 'PUT',
				headers: pdf
					? {
							authorization: `Bearer ${SEED_TOKEN}`,
							'content-type': 'application/pdf',
							'x-doc-title': ascii(doc.title),
							'x-doc-jurisdiction': ascii(doc.jurisdiction),
							'x-doc-level': doc.level,
							'x-doc-citation': ascii(doc.citation),
							'x-doc-source-url': doc.sourceUrl,
							'x-doc-authors': ascii(doc.authors),
							'x-doc-issuing-body': ascii(doc.issuingBody),
						}
					: { authorization: `Bearer ${SEED_TOKEN}`, 'content-type': 'text/markdown' },
				body: pdf ?? render(doc),
			});

			if (!response.ok) {
				stats.failed += 1;
				console.error(`  ✗ ${doc.key}: ${response.status} ${await response.text()}`);

				return;
			}

			stats.uploaded += 1;

			if (stats.uploaded % 100 === 0) console.log(`  [${name}] ${stats.uploaded} uploaded`);
		})().catch((error) => {
			// A failed download or upload must not take the whole run down.
			stats.failed += 1;
			console.error(`  ✗ ${doc.key}: ${error instanceof Error ? error.message : error}`);
		});

		inFlight.add(task);
		task.finally(() => inFlight.delete(task));

		// Back-pressure: hold the source until a slot frees up.
		if (inFlight.size >= CONCURRENCY) await Promise.race(inFlight);
	};

	await run(emit).catch((error) => console.error(`[${name}] aborted: ${error instanceof Error ? error.message : error}`));
	await Promise.all(inFlight);
	console.log(`[${name}] done`, stats);
}

console.table(totals);

console.log(UPLOAD ? '\nNow run: npx wrangler ai-search jobs create government-regulation-agent' : `\nWrote files to ${OUT_DIR}. Re-run with --upload to push them.`);

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

// Crawl a California code's TOC to the leaf branches and return their text
// page URLs. Branch pages link deeper branches; leaves link a text page.
// `match` narrows the crawl to one subtree: a branch or leaf URL qualifies
// when each given level is either equal or still unset (an ancestor page).
async function caLeafPages(base: string, code: string, match: Record<string, string> = {}) {
	const qualifies = (url: string, leaf: boolean) =>
		Object.entries(match).every(([level, value]) => {
			const actual = new URL(url).searchParams.get(level) ?? '';

			return actual === value || (!leaf && actual === '');
		});

	const leaves = new Set<string>();
	const seenBranches = new Set<string>();
	const queue = [`${base}/codesTOCSelected.xhtml?tocCode=${code}`];

	while (queue.length) {
		const url = queue.shift()!;

		if (seenBranches.has(url)) continue;
		seenBranches.add(url);
		const page = await text(url).catch(() => '');

		for (const m of page.matchAll(/codes_displayexpandedbranch\.xhtml\?[^"']+/g)) {
			const next = `${base}/${decodeEntities(m[0])}`;

			if (!seenBranches.has(next) && qualifies(next, false)) queue.push(next);
		}

		for (const m of page.matchAll(/codes_displayText\.xhtml\?[^"']+/g)) {
			const leaf = `${base}/${decodeEntities(m[0])}`;

			if (qualifies(leaf, true)) leaves.add(leaf);
		}
	}

	return [...leaves];
}

// R2 custom metadata and HTTP headers must be ASCII.
function ascii(value: string) {
	return value.replace(/§/g, 'Sec.').replace(/[—–]/g, '-').replace(/[^\x20-\x7e]/g, '').trim();
}

function caShort(codeName: string, code: string) {
	const known = new Map([['GOV', 'Gov. Code'], ['CIV', 'Civ. Code'], ['PEN', 'Penal Code'], ['BPC', 'Bus. & Prof. Code'], ['CCP', 'Civ. Proc. Code'], ['VEH', 'Veh. Code'], ['HSC', 'Health & Safety Code'], ['LAB', 'Lab. Code'], ['EDC', 'Educ. Code'], ['PRC', 'Pub. Res. Code'], ['WIC', 'Welf. & Inst. Code'], ['RTC', 'Rev. & Tax. Code'], ['PUC', 'Pub. Util. Code'], ['FAM', 'Fam. Code'], ['CORP', 'Corp. Code'], ['ELEC', 'Elec. Code'], ['EVID', 'Evid. Code'], ['FIN', 'Fin. Code'], ['INS', 'Ins. Code'], ['PCC', 'Pub. Cont. Code'], ['UIC', 'Unemp. Ins. Code'], ['WAT', 'Water Code'], ['FGC', 'Fish & Game Code'], ['FAC', 'Food & Agric. Code'], ['HNC', 'Harb. & Nav. Code'], ['MVC', 'Mil. & Vet. Code'], ['PROB', 'Prob. Code'], ['SHC', 'Sts. & Hy. Code'], ['CONS', 'Const.']]);

	return known.get(code) ?? `${codeName.replace(/ Code$/, '')} Code`;
}

async function ecfrDate() {
	if (cachedEcfrDate) return cachedEcfrDate;
	const titles = await json<{ titles: { number: number; up_to_date_as_of: string }[] }>('https://www.ecfr.gov/api/versioner/v1/titles.json');
	cachedEcfrDate = titles.titles.reduce((min, t) => (t.up_to_date_as_of < min ? t.up_to_date_as_of : min), '9999');

	return cachedEcfrDate;
}

// Retry transient failures with backoff; the sources rate-limit bursts.
async function request(url: string, attempt = 0): Promise<Response> {
	const response = await fetch(url, { headers: HEADERS }).catch((error) => {
		if (attempt >= 6) throw error;

		return null;
	});

	if (response?.ok) return response;

	if (attempt >= 6 || (response && response.status < 500 && response.status !== 429)) {
		throw new Error(`${response?.status ?? 'network'} ${url}`);
	}

	await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));

	return request(url, attempt + 1);
}

async function text(url: string) {
	return (await request(url)).text();
}

async function json<T>(url: string): Promise<T> {
	// SAFETY: each caller names the shape the endpoint documents; the sources
	// are government APIs whose responses are not validated further.
	return (await request(url)).json() as Promise<T>;
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
		.replace(/<\/?(?:p|div|tr|ul|ol|table|blockquote|section|extract|fp|note|cita|xref|subsection|paragraph|subparagraph|clause|chapeau|continuation|content)\b[^>]*>/gi, '\n\n')
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
	const named = new Map([['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', "'"], ['nbsp', ' '], ['sect', '§'], ['mdash', '—'], ['ndash', '–'], ['para', '¶'], ['ldquo', '“'], ['rdquo', '”'], ['lsquo', '‘'], ['rsquo', '’']]);

	return value
		.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
		.replace(/&([a-z]+);/gi, (match, name) => named.get(name.toLowerCase()) ?? match);
}

interface EcfrNode {
	type: string;
	identifier: string;
	label: string;
	label_description: string;
	reserved?: boolean;
	children?: EcfrNode[];
}

function collectWithPath(node: EcfrNode, predicate: (n: EcfrNode) => boolean, path: EcfrNode[] = []): { node: EcfrNode; path: EcfrNode[] }[] {
	return [
		...(predicate(node) ? [{ node, path }] : []),
		...(node.children ?? []).flatMap((c) => collectWithPath(c, predicate, [...path, node])),
	];
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

interface MunicodeClient {
	ClientID: number;
	ClientName: string;
	State: { StateName: string; StateAbbreviation: string };
}

interface TocNode {
	Id: string;
	Heading: string;
	HasChildren: boolean;
}

interface MunicodeHit {
	NodeId: string;
	Title: string;
	Product: { Id: string; Name: string };
	Ancestors: { NodeId: string; Title: string }[];
}

interface MunicodeDoc {
	Id: string;
	Title: string;
	NodeDepth: number;
	Content: string;
}
