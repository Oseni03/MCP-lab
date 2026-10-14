import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_PROFILE, type Profile } from "@/lib/job-hunter/profile.ts";
import {
	adjacentDomainNames,
	careerTargetNames,
	primarySkillNames,
	secondarySkillNames,
	strongDomainNames,
} from "@/lib/job-hunter/profile.ts";
import { RESEARCH_TTL_DAYS, normalizeCompany } from "@/lib/job-hunter/research-company.ts";

/**
 * Versioned resource and prompt catalog (ticket 06). Private server
 * defaults are embedded here; tools load the caller's stored profile,
 * and the candidate-profile resource serves it per request. Missing
 * entries degrade to explicit errors, never guesses. The host owns
 * compilation; the server only serves text plus signals.
 */

export interface ResourceDescriptor {
	uri: string;
	name: string;
	title: string;
	description: string;
	version: number;
	mimeType: string;
}

interface ResourceBody extends ResourceDescriptor {
	text: string;
}

function profileText(): string {
	return renderProfileResource(DEFAULT_PROFILE, false);
}

/**
 * Candidate-profile resource body in the stable markdown shape. The server
 * renders the caller's stored profile when one resolves (stored=true) and
 * the embedded defaults otherwise; the trailing line always states which.
 */
export function renderProfileResource(profile: Profile, stored: boolean): string {
	const lines = [
		stored ? "# Candidate profile (stored for this caller)" : "# Candidate profile (server default v1)",
		"",
		`Name: ${profile.name}`,
		`Location: ${profile.location}`,
		`Work country: ${profile.workCountry}`,
		`Permit classes: ${profile.permitClasses.join(", ") || "undeclared"}`,
		`Languages: ${profile.languages.map((entry) => `${entry.language} (${entry.level})`).join(", ") || "undeclared"}`,
		`Primary skills: ${primarySkillNames(profile).join(", ") || "unset; run setup-profile"}`,
		`Secondary skills: ${secondarySkillNames(profile).join(", ") || "unset"}`,
		`Strong domains: ${strongDomainNames(profile).join(", ") || "unset"}`,
		`Adjacent domains: ${adjacentDomainNames(profile).join(", ") || "unset"}`,
		`Target roles: ${careerTargetNames(profile).join(", ") || "unset"}`,
		"",
		stored
			? "Stored profile for the authenticated caller; run setup-profile again to update it."
			: "Embedded defaults; run setup-profile with dbWrite to store the caller's profile.",
	];
	return lines.join("\n");
}

const RESOURCES: ResourceBody[] = [
	{
		uri: "job-hunter://profile/candidate",
		name: "candidate-profile",
		title: "Candidate profile",
		description:
			"Identity, skills, domains, and target roles every tool grounds its output in. Serves the caller's stored profile; embedded defaults when none is stored.",
		version: 2,
		mimeType: "text/markdown",
		text: profileText(),
	},
	{
		uri: "job-hunter://profile/behavioral",
		name: "behavioral-profile",
		title: "Behavioral profile",
		description: "Energizing and draining tasks plus strengths used for behavioral scoring and steer-away notes.",
		version: 1,
		mimeType: "text/markdown",
		text: [
			"# Behavioral profile (server default v1)",
			"",
			`Energizing tasks: ${DEFAULT_PROFILE.energizingTasks.join(", ") || "unset; run /setup"}`,
			`Draining tasks: ${DEFAULT_PROFILE.drainingTasks.join(", ") || "unset"}`,
			"",
			"Energizing tasks add to the behavioral score; draining tasks subtract and become steer-away notes.",
		].join("\n"),
	},
	{
		uri: "job-hunter://rules/writing",
		name: "writing-rules",
		title: "Writing rules",
		description: "Bans and voice rules enforced on every generated document.",
		version: 1,
		mimeType: "text/markdown",
		text: [
			"# Writing rules (server default v1)",
			"",
			"- No em-dashes; use commas, periods, or restructure.",
			"- No cliches (passionate about, hit the ground running, synergies, ...).",
			"- No apologetic hedging (I think I could, I hope to, ...).",
			"- Active first-person voice throughout.",
			"- No unverified company claims; caller-verified specifics only.",
			"- HTML safety: escape every profile and posting-derived value; generated documents contain no executable markup.",
		].join("\n"),
	},
	{
		uri: "job-hunter://framework/evaluation",
		name: "evaluation-framework",
		title: "Evaluation framework",
		description: "Five-dimension weights, verdict bands, and gates shared by evaluation and triage.",
		version: 1,
		mimeType: "text/markdown",
		text: [
			"# Evaluation framework (server default v1)",
			"",
			"- Dimensions and weights: Technical 30, Experience 25, Behavioral 15, Career 30.",
			"- Location is PASS/FAIL/FLAG and never weighted.",
			"- Verdict bands: 75 Strong Fit, 60 Good Fit, 45 Moderate Fit, 30 Weak Fit, below Poor Fit.",
			"- Gates run first: Eligibility (citizenship/clearance FAIL stops), Language Gate (undeclared FAIL, higher-bar FLAG).",
		].join("\n"),
	},
	{
		uri: "job-hunter://templates/cv",
		name: "cv-template",
		title: "CV template guidance",
		description: "Fixed modern HTML CV contract: two pages, translated headings, Puppeteer A4 rendering.",
		version: 1,
		mimeType: "text/markdown",
		text: [
			"# CV template guidance (server default v1)",
			"",
			"- Stock template: modern-fixed-v1, rendered by Puppeteer to an A4 PDF targeting exactly 2 pages.",
			"- Section headings follow the CV language; every non-English CV swaps each one.",
			"- Experience entries avoid page breaks; rendered page count is checked after PDF generation.",
			"- The template is fixed and cannot be overridden by a request.",
		].join("\n"),
	},
	{
		uri: "job-hunter://templates/cover-letter",
		name: "cover-template",
		title: "Cover letter template guidance",
		description: "Fixed modern HTML cover-letter contract: one page, 250-300 words, Puppeteer A4 rendering.",
		version: 1,
		mimeType: "text/markdown",
		text: [
			"# Cover letter template guidance (server default v1)",
			"",
			"- Stock template: letter-modern-fixed-v1, rendered by Puppeteer to an A4 PDF targeting exactly 1 page.",
			"- Forward-looking task-solving: opening plus bullets plus company connection plus fit plus close, 250-300 words.",
			"- Salutation and structure follow the posting language.",
			"- The template is fixed and cannot be overridden by a request.",
		].join("\n"),
	},
	{
		uri: "job-hunter://reference/cv-master",
		name: "cv-master-reference",
		title: "CV master reference",
		description: "Master CV factual source: the audit union member every claim traces to.",
		version: 1,
		mimeType: "text/markdown",
		text: [
			"# CV master reference (server default v1)",
			"",
			"- The master CV joins the factual-audit union with the candidate profile and workspace profile; every generated claim traces to at least one member.",
			"- Caller-supplied masterCvText wins over any server copy; generation never depends on server disk.",
			"- Structure only: competencies, experience, education. Never invent dates, titles, or outcomes.",
			"- Template version: modern-fixed-v1 (Puppeteer, exactly 2 pages target); framework version: evaluation v1.",
		].join("\n"),
	},
	{
		uri: "job-hunter://reference/cover-example",
		name: "cover-example",
		title: "Cover letter structural example",
		description: "Structural reference for fixed HTML cover letters plus the one-page render contract.",
		version: 1,
		mimeType: "text/markdown",
		text: [
			"# Cover example (server default v1)",
			"",
			"- Host file: cover_letters/cover_<slug>.html (structural reference only, never a fact source).",
			"- Pattern: fixed semantic paragraphs and a structured bullet list, rendered with the same document font.",
			"- Contract: Puppeteer A4 PDF targeting exactly 1 page and 250-300 words.",
			"- Template version: letter-modern-fixed-v1; framework version: evaluation v1.",
		].join("\n"),
	},
	{
		uri: "job-hunter://strategy/search-queries",
		name: "search-query-strategy",
		title: "Search query strategy",
		description: "Function-based, per-language query strategy with the 14-day window and scraper order.",
		version: 1,
		mimeType: "text/markdown",
		text: [
			"# Search query strategy (server default v1)",
			"",
			"- Organize by function, not title; render every category in every profile language.",
			"- Scope: last 14 days; unknown dates flagged, never dropped; result cap 20 per call.",
			"- Order: Site clients (Indeed/LinkedIn) first, then local scrapers; every search runs the scraper adapters.",
			"- Never scrape people-search pages; never fabricate postings.",
			"- Framework version: evaluation v1.",
		].join("\n"),
	},
	{
		uri: "job-hunter://templates/cv-variants",
		name: "cv-variant-listing",
		title: "Base CV variant listing",
		description: "Listable base variants plus single-variant fetch with caller-supplied fallback.",
		version: 1,
		mimeType: "text/markdown",
		text: [
			"# Base CV variants (server default v1)",
			"",
			"- modern-fixed-v1: fixed HTML template for all CVs (Puppeteer, 2 pages target).",
			"- Fetch one variant with getCvVariant(name); pass caller base content via resolveBaseContent so tailoring never depends on server disk.",
			"- Template version: modern-fixed-v1.",
		].join("\n"),
	},
	{
		uri: "job-hunter://state/seen-keys",
		name: "seen-keys-pointer",
		title: "Seen-keys state pointer",
		description: "Caller-held dedup identifiers and counts only; never full backlog contents.",
		version: 1,
		mimeType: "text/markdown",
		text: [
			"# Seen-keys pointer (server default v1)",
			"",
			"- The host owns seen_jobs.json; tools return stability-ready keys.",
			"- This resource carries identifiers and counts only, never full backlog contents (state-through-tool invariant).",
			"- Missing store degrades to an explicit message; nothing is guessed.",
		].join("\n"),
	},
	{
		uri: "job-hunter://state/tracker",
		name: "tracker-pointer",
		title: "Application tracker pointer",
		description: "Caller-held application tracker pointer; portable rows only, never full contents.",
		version: 1,
		mimeType: "text/markdown",
		text: [
			"# Tracker pointer (server default v1)",
			"",
			"- The host owns job_search_tracker.csv; track-application returns a portable row plus full tracker text for verbatim write, with a tracker hash the host checks before writing (re-read on mismatch).",
			"- This resource carries identifiers and counts only, never full tracker contents (state-through-tool invariant).",
			"- Missing tracker degrades to an explicit message; nothing is guessed.",
		].join("\n"),
	},
	{
		uri: "job-hunter://research/companies",
		name: "research-pointer",
		title: "Per-company research pointer",
		description: "Pattern for per-company entries: job-hunter://research/company/<slug> with TTL and caller fallback.",
		version: 1,
		mimeType: "text/markdown",
		text: [
			"# Per-company research pointer (server default v1)",
			"",
			"- Per-company entries live at job-hunter://research/company/<slug> (slug: lowercase hyphen, e.g. acme-corp).",
			"- Backed by company_research/<slug>.json with a 30-day TTL; stale or missing entries degrade to explicit messages, never guesses.",
			"- Caller-supplied cache content wins over server disk so generation never depends on it.",
			"- Framework version: evaluation v1.",
		].join("\n"),
	},
	{
		uri: "jobs://applied",
		name: "applied-jobs",
		title: "Applied jobs (per-user, DB-backed)",
		description: "Live per-user applied rows; query via track-application state or due-followups. User-scoped, never cross-user.",
		version: 1,
		mimeType: "text/markdown",
		text: [
			"# Applied jobs (per-user v1)",
			"",
			"- Source of truth: Prisma Application rows WHERE userId = :me AND status = applied.",
			"- Read via the due-followups tool (structured applications) or the track-application state; this resource carries the query pattern, never another user's rows.",
			"- Export: job_search_tracker.csv filtered to this user.",
		].join("\n"),
	},
	{
		uri: "jobs://interviewing",
		name: "interviewing-jobs",
		title: "Interviewing jobs (per-user, DB-backed)",
		description: "Live per-user interviewing rows; feeds prepare-interview. User-scoped, never cross-user.",
		version: 1,
		mimeType: "text/markdown",
		text: [
			"# Interviewing jobs (per-user v1)",
			"",
			"- Source of truth: Prisma Application rows WHERE userId = :me AND status = interviewing.",
			"- Route each pick to prepare-interview with the archived posting plus submitted CV and letter.",
			"- This resource carries the query pattern, never another user's rows.",
		].join("\n"),
	},
	{
		uri: "applications://due",
		name: "due-applications",
		title: "Due follow-ups (per-user, DB-backed)",
		description: "Follow-up queue pattern: due-followups over this user's open applications. User-scoped.",
		version: 1,
		mimeType: "text/markdown",
		text: [
			"# Due follow-ups (per-user v1)",
			"",
			"- Query: due-followups with this user's open applications (untouched >= 7d or deadline within 3d, saved excluded).",
			"- Each entry carries daysStale, reason, and a suggested action, oldest first.",
			"- This resource carries the query pattern, never another user's rows.",
		].join("\n"),
	},
];

export function listResources(): ResourceDescriptor[] {
	return RESOURCES.map(({ text: _text, ...descriptor }) => descriptor);
}

export type ResourceRead =
	| { ok: true; uri: string; version: number; text: string; overridden: boolean }
	| { ok: false; uri: string; error: string };

/** Server default text, or the per-call override when one is supplied. */
export function getResource(uri: string, override?: string): ResourceRead {
	const entry = RESOURCES.find((resource) => resource.uri === uri);
	if (!entry) {
		return { ok: false, uri, error: `Unknown resource ${uri}; no default exists and nothing was guessed.` };
	}
	if (override !== undefined) {
		return { ok: true, uri, version: entry.version, text: override, overridden: true };
	}
	return { ok: true, uri, version: entry.version, text: entry.text, overridden: false };
}

export interface CvVariantDescriptor {
	name: string;
	description: string;
}

const CV_VARIANTS: Record<string, { description: string; content: string }> = {
	"modern-fixed-v1": {
		description: "Fixed HTML CV template rendered by Puppeteer to an A4 PDF (2 pages target).",
		content: "The active CV template is fixed modern-fixed-v1; requests cannot select a different renderer.",
	},
};

/** Base CV variants are listable and fetchable without touching server disk. */
export function listCvVariants(): CvVariantDescriptor[] {
	return Object.entries(CV_VARIANTS).map(([name, variant]) => ({ name, description: variant.description }));
}

export type VariantRead =
	| { ok: true; name: string; text: string; fromCaller: boolean }
	| { ok: false; name: string; error: string };

export function getCvVariant(name: string): VariantRead {
	const variant = CV_VARIANTS[name];
	if (!variant) {
		return {
			ok: false,
			name,
			error: `Unknown base variant ${name}; available: ${Object.keys(CV_VARIANTS).join(", ")}.`,
		};
	}
	return { ok: true, name, text: variant.content, fromCaller: false };
}

/**
 * Direct passthrough of caller-supplied base content as fallback, so
 * tailoring never depends on server disk. Caller content always wins.
 */
export function resolveBaseContent(name: string, callerContent?: string): VariantRead {
	if (callerContent !== undefined && callerContent.trim() !== "") {
		return { ok: true, name, text: callerContent, fromCaller: true };
	}
	return getCvVariant(name);
}

export interface ResearchResourceOptions {
	cacheDir?: string;
	callerContent?: string;
	now?: Date;
}

export type ResearchResourceRead =
	| { ok: true; slug: string; uri: string; version: number; text: string; fromCaller: boolean }
	| { ok: false; slug: string; uri: string; error: string };

function normalizeSlug(slug: string): string {
	return normalizeCompany(slug);
}

function researchFresh(fetchedDate: string, now: Date): boolean {
	const fetched = new Date(`${fetchedDate}T00:00:00Z`).getTime();
	if (Number.isNaN(fetched)) {
		return false;
	}
	return now.getTime() - fetched <= RESEARCH_TTL_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Per-company research entries with caller-supplied fallback, so
 * generation never depends on server disk. Stale or missing entries
 * degrade to explicit messages rather than guesses, preserving the
 * state-through-tool invariant (identifiers and counts only elsewhere).
 */
export function getCompanyResearchResource(
	slug: string,
	options: ResearchResourceOptions = {},
): ResearchResourceRead {
	const normalized = normalizeSlug(slug);
	const uri = `job-hunter://research/company/${normalized || slug}`;
	const now = options.now ?? new Date();
	if (options.callerContent !== undefined && options.callerContent.trim() !== "") {
		try {
			const entry = JSON.parse(options.callerContent) as { fetched_date?: string };
			if (entry.fetched_date && researchFresh(entry.fetched_date, now)) {
				return { ok: true, slug: normalized, uri, version: 1, text: options.callerContent, fromCaller: true };
			}
			return {
				ok: false,
				slug: normalized,
				uri,
				error: `Research entry for ${slug} is stale or undated in caller content; re-run research-company. Nothing was guessed.`,
			};
		} catch {
			return {
				ok: false,
				slug: normalized,
				uri,
				error: `Caller research content for ${slug} is unparseable; re-run research-company. Nothing was guessed.`,
			};
		}
	}
	if (options.cacheDir) {
		const path = join(options.cacheDir, `${normalized}.json`);
		if (!existsSync(path)) {
			return {
				ok: false,
				slug: normalized,
				uri,
				error: `No research entry for ${slug} at ${path}; run research-company first. Nothing was guessed.`,
			};
		}
		try {
			const text = readFileSync(path, "utf-8");
			const entry = JSON.parse(text) as { fetched_date?: string };
			if (entry.fetched_date && researchFresh(entry.fetched_date, now)) {
				return { ok: true, slug: normalized, uri, version: 1, text, fromCaller: false };
			}
			return {
				ok: false,
				slug: normalized,
				uri,
				error: `Research entry for ${slug} is stale (fetched ${entry.fetched_date ?? "unknown"}); re-run research-company. Nothing was guessed.`,
			};
		} catch {
			return {
				ok: false,
				slug: normalized,
				uri,
				error: `Research entry for ${slug} is unparseable; re-run research-company. Nothing was guessed.`,
			};
		}
	}
	return {
		ok: false,
		slug: normalized,
		uri,
		error: `No research entry for ${slug} held; supply caller content or a cache dir, or run research-company. Nothing was guessed.`,
	};
}

export interface PromptDescriptor {
	name: string;
	title: string;
	description: string;
	version: number;
}

interface PromptBody extends PromptDescriptor {
	text: string;
}

const PROMPTS: PromptBody[] = [
	{
		name: "apply",
		title: "Apply workflow",
		description: "End-to-end application flow from fetch to record.",
		version: 2,
		text: [
			"# Apply workflow (v2)",
			"",
			"Drive the end-to-end application without hardcoding the manual workflow; call tools, do not guess.",
			"",
			"1. Fetch with escalation and host verification: paste text when held, else fetch the posting URL via direct fetch, robots-checked browser-header retry, then employer-site search; prefer the employer posting over aggregators, note discrepancies, and declare genuinely unavailable rather than drafting from a title.",
			"2. Gate then score: run the Eligibility gate before scoring (FAIL stops with quoted wording), then the Language gate (undeclared FAIL stops, higher-bar FLAG proceeds with quoted requirement and declared level), then score the five dimensions with weights Technical 30 / Experience 25 / Behavioral 15 / Career 30 and verdict bands 75/60/45/30.",
			"3. Ask-to-proceed: present fit, strengths, gaps, and employer-call advice with needsConfirmation, then ask Should I proceed with drafting before writing anything.",
			"4. Draft with requirement coverage and grounding audit: tailor the CV and cover letter per section rules; every requirement matched or honestly bridged, nice-to-haves by name; every claim traces to the profile union (no drift); agentic tooling names Claude Code.",
			"5. Reviewer critique in two parts: cache-first company research, then Part A grounding edits as JSON file/old_string/new_string/reason plus Part B missed keywords, company angles, reframing, and tone notes.",
			"6. Revise: apply Part A via edit (skip fabricating edits), apply Part B with judgment using verified company specifics only.",
			"7. Mandatory render and inspect: host writes the returned HTML and PDF, confirms the CV target is 2 pages and the letter target is 1 page, then visually inspects both documents.",
			"8. Text-layer and keyword verification: extract the text layer (ASCII dates, literal contacts, reading order) and check posting-keyword coverage; add covered terms honestly, never stuff gaps.",
			"9. Single verification pass plus record plus optional form fields: run the factual/targeting/consistency/quality/PDF/ATS checklist once, then track-application (pass the user's local day as today, host writes the tracker verbatim only if the file still matches the returned tracker hash, and archives the posting), then offer 08 form fields by name only.",
		].join("\n"),
	},
	{
		name: "rank",
		title: "Rank workflow",
		description: "Batch triage flow from focus text to shortlist.",
		version: 2,
		text: [
			"# Rank workflow (v2)",
			"",
			"1. Parse focus and limits: empty means up to 10 new jobs; focus text matches title/company/notes only; limit bounds fetch-and-score work (default 10); top bounds shortlist display only (default 5); all re-ranks ranked entries after a profile change.",
			"2. Load state via query tool: query candidates without reading the store into context; report eligible, deferred, and tracker-excluded counts; tracker exclusion applies regardless of flags.",
			"3. Batch fetch-or-expired with escalation: fetch each posting URL with direct, browser-header, and employer-site escalation; dead, redirected, or login-walled pages become expired after full escalation; never score from a title alone and never fabricate content.",
			"4. Aggregate with weights vetoes urgency sweep and staleness: weight 30/25/15/30 with bands 75/60/45/30; location FAIL or language FAIL excluded with quoted reason while FLAGs stay flagged; deadlines within 7 days close soon with urgency tiebreak and past deadlines expire; sweep stored deadlines for newly expired and closing-soon without guessing absent dates; posted dates over 30 days flag stale without veto.",
			"5. Update state through tool: persist additive-only rank fields (score, verdict, date, location and language verdicts with note, refreshed deadline, verbatim strengths and gaps) via rank-jobs; never touch the tracker.",
			"6. Present shortlist and route picks to full evaluation: show shortlist plus why-each-ranked, closing-soon, below-threshold, and excluded sections with posting links; state triage limits; on a pick run analyze-job on that URL with triage as context but always re-run full evaluation.",
		].join("\n"),
	},
	{
		name: "interview",
		title: "Interview workflow",
		description: "Stage-prep flow from archive to mock run.",
		version: 2,
		text: [
			"# Interview workflow (v2)",
			"",
			"1. Match tracked application: match company then role case-insensitively against the tracker; drafted rows never qualify; list live-process rows when ambiguous.",
			"2. Load archive with no sibling globs: read documents/applications/<company>_<role>/ posting, submitted CV and letter, and outcome stage history only; never glob sibling roles; state gaps plainly and ask for missing stage (recruiter-screen, technical, hiring-manager, panel-onsite, other; phone screen and HR round read as recruiter-screen, system design as technical, final round as panel-onsite), date, format, and interviewers.",
			"3. Cache-first research with interviewer angle and hooks: reuse company_research/<slug>.json within TTL, else research site, reviews, team signals, and media from the company name and official site; verify every pack claim via fetch; add interviewer angle from public professional info only plus 2-3 verifiable conversation hooks.",
			"4. Stage pack with STAR map consistency brief tough questions questions-to-ask and logistics: order likely questions feedback first, then fit gaps with honest bridges, then posting requirements, then stage type; map STAR examples by Use-for tags and draft new STAR from profile facts only; brief consistency between paper and room; customize tough why-us questions from verified hooks; pick 4-6 stage-appropriate questions to ask; include phone/video logistics and save one per-stage pack to the archive.",
			"5. Optional mock per roleplay rules: on yes, run warm-up, technical, 1-2 behavioral, then a tough curveball with brief per-answer feedback and STAR pointers, coached toward the natural register.",
			"6. Close via outcome logging: wish luck, re-offer deferred STAR appends, and direct the candidate to log the outcome for calibration.",
		].join("\n"),
	},
	{
		name: "scrape-health",
		title: "Scrape health workflow",
		description: "Portal-health check flow with bounded probing.",
		version: 2,
		text: [
			"# Scrape-health workflow (v2)",
			"",
			"1. Bounded free-pass scan: review this run's portal output for null or empty companies and titles, entities or HTML in titles, off-portal URLs, and zero-result portals with prior history; healthy portals stay silent.",
			"2. Single sentinel probe with retry: probe each suspect once with the documented example query at limit 3, then one common-word retry on failure; back off on 429 or blocks.",
			"3. Verdicts for degraded broken and rate-limited only from observed output: degraded on partial or malformed output, broken on repeated probe failure, rate-limited (inconclusive) on 429 or blocks; never accuse from a single quiet run.",
			"4. Toggle edit only with confirmation: offer enabled false for broken portals and apply the health-check edit only after explicit confirmation.",
		].join("\n"),
	},
	{
		name: "tailor-flow",
		title: "Tailor workflow",
		description: "Document tailoring flow with page budgets and cutting order.",
		version: 2,
		text: [
			"# Tailor-flow workflow (v2)",
			"",
			"1. Use the fixed document templates: modern-fixed-v1 for CVs and letter-modern-fixed-v1 for cover letters; requests cannot override the renderer.",
			"2. Read one structural reference each: read one existing CV plus one existing cover letter for structure only; truth stays the profile union of candidate profile, master CV, and workspace profile.",
			"3. Tailor per section rules with page budgets and cutting order: profile statement with domain-transfer lead when pivoting, 5-7 competencies with posting terms as labels, relevance-ordered measurable bullets, correct section order per role type; cover letter forward-looking task-solving in 250-300 words; shape content to the page budget (CV cutting oldest bullets first, then publications, competencies, profile; letter weakest bullet first) and never squeeze geometry.",
			"4. Compile and verify before presenting: host compiles with the declared toolchain, then text-layer, ATS, and keyword verification; fix orphans with needspace and near-miss overflow with enlargethispage; present tailoring decisions, files, and stretch choices for keep, soften, or drop.",
		].join("\n"),
	},
	{
		name: "apply-to-job",
		title: "Apply to job (tool orchestration)",
		description: "Orchestrates existing tools end to end: analyze, tailor, letter, answers, track. No new logic.",
		version: 1,
		text: [
			"# Apply-to-job (v1, orchestration only)",
			"",
			"Call existing tools in order; do not guess between steps.",
			"",
			"1. analyze-job on the posting (postingText preferred, postingUrl fallback). Stop on Eligibility FAIL or Language FAIL.",
			"2. tailor-resume with the evaluation summary plus masterCvText. Host compiles to 2 pages.",
			"3. generate-cover-letter with verified company specifics only. Host compiles to 1 page.",
			"4. draft-application-answers for portal fields by name only (ephemeral scratch, never a record).",
			"5. track-application to record the finished documents (host passes its local day, writes on hash match).",
			"6. Report files, verification checklist result, and the tracker row. Offer due-followups scheduling by name only.",
		].join("\n"),
	},
	{
		name: "interview-prep",
		title: "Interview prep (tool orchestration)",
		description: "Thin wrapper over prepare-interview with profile plus job context. No new logic.",
		version: 1,
		text: [
			"# Interview-prep (v1, orchestration only)",
			"",
			"1. Match the tracked application (company, role) and load its archive: posting, submitted CV and letter, stage history.",
			"2. Call prepare-interview (canonical) with profile context, stage, logistics, and caller-verified company facts.",
			"3. Present the pack: likely questions, STAR map, consistency brief, tough questions, questions to ask, logistics.",
			"4. Offer a mock run and direct the candidate to log the outcome for calibration.",
		].join("\n"),
	},
];

export function listPrompts(): PromptDescriptor[] {
	return PROMPTS.map(({ text: _text, ...descriptor }) => descriptor);
}

export type PromptRead =
	| { ok: true; name: string; version: number; text: string; overridden: boolean }
	| { ok: false; name: string; error: string };

/** Server default prompt text, or the per-call override when one is supplied. */
export function getPrompt(name: string, override?: string): PromptRead {
	const entry = PROMPTS.find((prompt) => prompt.name === name);
	if (!entry) {
		return { ok: false, name, error: `Unknown prompt ${name}; nothing was guessed.` };
	}
	if (override !== undefined) {
		return { ok: true, name, version: entry.version, text: override, overridden: true };
	}
	return { ok: true, name, version: entry.version, text: entry.text, overridden: false };
}
