import type { DashboardData, DashboardItem, DashboardView, ToolAction } from "./types.ts";

/**
 * Maps each job-hunter tool's call (arguments + structured result + markdown
 * text fallback) to the shared dashboard view model. Every mapper degrades
 * gracefully: missing fields yield shorter sections, never guesses. Unknown
 * tools fall back to the markdown text any tool already returns.
 */

export const TOOL_NAMES = [
	"analyze-job",
	"tailor-resume",
	"generate-cover-letter",
	"track-application",
	"prepare-interview",
	"career-strategy",
	"draft-application-answers",
	"rank-jobs",
	"research-company",
	"research-job",
	"search-jobs",
	"setup-profile",
	"due-followups",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export const TOOL_LABELS: Record<string, string> = {
	"analyze-job": "Analyze job",
	"tailor-resume": "Tailor resume",
	"generate-cover-letter": "Generate cover letter",
	"track-application": "Track application",
	"prepare-interview": "Prepare interview",
	"career-strategy": "Career strategy",
	"draft-application-answers": "Draft application answers",
	"rank-jobs": "Rank jobs",
	"research-company": "Research company",
	"research-job": "Research job",
	"search-jobs": "Search jobs",
	"setup-profile": "Setup profile",
	"due-followups": "Due follow-ups",
};

/**
 * Routing table: every tool renders its own view, unique to its output.
 * Unknown tools fall back to "overview" with their markdown text.
 */
export const TOOL_VIEWS: Record<string, DashboardView> = {
	"analyze-job": "analysis",
	"tailor-resume": "cv",
	"generate-cover-letter": "letter",
	"track-application": "track",
	"prepare-interview": "interview",
	"career-strategy": "strategy",
	"draft-application-answers": "answers",
	"rank-jobs": "rank",
	"research-company": "research",
	"research-job": "brief",
	"search-jobs": "search",
	"setup-profile": "profile",
	"due-followups": "followups",
};

type Rec = Record<string, unknown>;

/** Field accessors shared with the per-tool views; missing fields yield nothing, never guesses. */
export function rec(value: unknown): Rec {
	return typeof value === "object" && value !== null ? (value as Rec) : {};
}

export function list(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

export function strings(value: unknown): string[] {
	return list(value).filter((entry): entry is string => typeof entry === "string");
}

export function text(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

export function num(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Builds tool-call args from the known string fields, skipping blanks. */
export function toolArgs(source: Rec, ...fields: string[]): Record<string, unknown> {
	const args: Record<string, unknown> = {};
	for (const field of fields) {
		const value = text(source[field]);
		if (value !== "") args[field] = value;
	}
	return args;
}

/**
 * Args for tailor-resume / generate-cover-letter buttons. Both tools require
 * postingText, so callers must route through here: it carries the text when
 * the source holds it, and yields nothing usable when it does not (in which
 * case the button must be omitted — a call without postingText always fails
 * input validation).
 */
export function tailorLetterArgs(source: Rec): Record<string, unknown> {
	return {
		...toolArgs(source, "company", "role", "postingUrl"),
		...(() => {
			const postingText = text(source["postingText"]);
			return postingText !== "" ? { postingText } : {};
		})(),
	};
}

/** True when the args can satisfy tailor-resume / generate-cover-letter input. */
export function hasPostingText(source: Rec): boolean {
	return text(source["postingText"]) !== "";
}

const DESCRIPTION_EXCERPT_LIMIT = 2000;

function excerpt(value: unknown, limit: number): string | undefined {
	const str = text(value);
	if (str.trim() === "") return undefined;
	if (str.length <= limit) return str;
	return `${str.slice(0, limit)}\n\n…truncated to the first ${limit} characters`;
}

function postingTitle(role?: string, company?: string, fallback = "Result"): string {
	if (role && company) return `${role} at ${company}`;
	return role ?? company ?? fallback;
}

function companyRole(args: Rec): { company?: string; role?: string } {
	const company = text(args["company"]) || undefined;
	const role = text(args["role"]) || undefined;
	return { company, role };
}

function coverageItems(coverage: unknown): DashboardItem[] {
	return list(coverage).map((entry) => {
		const item = rec(entry);
		const kind = text(item["kind"]);
		const evidence = text(item["evidence"]);
		return {
			title: text(item["requirement"], "Requirement"),
			verdict: text(item["status"]) || undefined,
			note: [kind, evidence ? `— ${evidence}` : ""].filter((part) => part !== "").join(" ") || undefined,
		};
	});
}

function mapAnalysis(args: Rec, structured: Rec, markdown?: string): DashboardData {
	const { company, role } = companyRole(args);
	const verdict = text(structured["verdict"]) || null;
	const score = num(structured["overallScore"]);
	const eligibility = rec(structured["eligibility"]);
	const languageGate = rec(structured["languageGate"]);
	const dimensions = list(structured["dimensions"]);
	const postingUrl = text(args["postingUrl"]);
	const description =
		excerpt(args["postingText"], DESCRIPTION_EXCERPT_LIMIT) ??
		(postingUrl !== "" ? `Full posting: ${postingUrl}` : undefined);
	// Tailor/letter buttons need the posting text (required input); the record
	// button needs tailored files that do not exist yet at analysis time, so
	// it is omitted here rather than offered as a call that always fails.
	const posting = tailorLetterArgs(args);
	const actions: ToolAction[] = [
		...(hasPostingText(args)
			? [
				{ label: "Tailor a resume for this role", tool: "tailor-resume", args: posting },
				{ label: "Draft the cover letter", tool: "generate-cover-letter", args: posting },
			]
			: []),
	];
	return {
		view: "analysis",
		title: postingTitle(role, company, "Job Fit Evaluation"),
		summary: [
			`${verdict ?? "Not scored"}${score !== undefined ? ` ${score}/100` : ""}`,
			`Eligibility ${text(eligibility["verdict"], "?")} · Language ${text(languageGate["verdict"], "?")}`,
		].join(" · "),
		description,
		items: dimensions.map((entry) => {
			const dimension = rec(entry);
			return {
				title: text(dimension["dimension"], "Dimension"),
				score: num(dimension["score"]),
				note: text(dimension["notes"]) || undefined,
			};
		}),
		markdown,
		actions,
	};
}

function mapRank(_args: Rec, structured: Rec, markdown?: string): DashboardData {
	const shortlist = list(structured["shortlist"]);
	const excluded = list(structured["excluded"]);
	return {
		view: "rank",
		title: "Ranked shortlist",
		summary: [
			`Eligible ${num(structured["eligibleCount"]) ?? shortlist.length}`,
			`shortlisted ${shortlist.length}`,
			`excluded ${excluded.length}`,
			`deferred ${num(structured["deferredCount"]) ?? 0}`,
		].join(" · "),
		items: shortlist.map((entry) => {
			const item = rec(entry);
			const deadline = text(item["deadline"]);
			const postingUrl = text(item["url"]);
			const analyzeArgs = {
				...toolArgs(item, "company"),
				...(text(item["title"]) !== "" ? { role: text(item["title"]) } : {}),
				...(postingUrl !== "" ? { postingUrl } : {}),
			};
			return {
				title: text(item["title"], "Posting"),
				company: text(item["company"]) || undefined,
				score: num(item["score"]),
				verdict: text(item["verdict"]) || undefined,
				url: postingUrl || undefined,
				note:
					[
						`Location ${text(item["locationVerdict"], "?")}`,
						`language ${text(item["languageGate"], "?")}`,
						deadline !== "" ? `deadline ${deadline}` : "",
					]
						.filter((part) => part !== "")
						.join(" · ") || undefined,
				...(postingUrl !== ""
					? { action: { label: "Analyze this posting", tool: "analyze-job", args: analyzeArgs } }
					: {}),
			};
		}),
		markdown,
		actions: [{ label: "Search for more roles", tool: "search-jobs" }],
	};
}

function mapSearch(_args: Rec, structured: Rec, markdown?: string): DashboardData {
	const jobs = list(structured["jobs"]);
	const filters = rec(structured["filters"]);
	const keywords = text(filters["keywords"]);
	const cursor = text(structured["nextCursor"]);
	// Pagination resumes the same result set, so the next-page call must
	// carry the original page size and filters; otherwise the cursor offset
	// slices with a different limit and pages overlap or skip.
	const pageLimit = num(filters["limit"]);
	return {
		view: "search",
		title: "Job search results",
		summary: [
			keywords !== "" ? `"${keywords}"` : "all",
			`${jobs.length} jobs`,
		].join(" · "),
		items: jobs.map((entry) => {
			const job = rec(entry);
			const postingUrl = text(job["url"]);
			const title = text(job["title"]);
			const company = text(job["company"]);
			// The thin list carries no scores or snippets; the single
			// next step is analyze-job on the Remotive URL (Groq fit).
			const analyze = postingUrl !== ""
				? { label: "Analyze this job", tool: "analyze-job", args: { jobUrl: postingUrl } }
				: undefined;
			const postedRaw = job["postedAt"];
			return {
				title: title !== "" ? title : "Posting",
				id: text(job["id"]) || undefined,
				company: company || undefined,
				url: postingUrl || undefined,
				location: text(job["location"]) || undefined,
				remoteType: job["remote"] === true ? "remote" : undefined,
				source: "remotive",
				postedAt: typeof postedRaw === "string" && postedRaw !== "" ? postedRaw : null,
				...(analyze ? { actions: [analyze], action: analyze } : {}),
			};
		}),
		markdown,
		actions: [
			...(cursor !== ""
				? [{
					label: "Fetch the next page",
					tool: "search-jobs",
					args: {
						...toolArgs(filters, "keywords", "location"),
						...(pageLimit !== undefined ? { limit: pageLimit } : {}),
						cursor,
					},
				}]
				: []),
		],
	};
}

function mapInterview(args: Rec, structured: Rec, markdown?: string): DashboardData {
	const company = text(structured["company"]) || text(args["company"]) || undefined;
	const role = text(structured["role"]) || text(args["role"]) || undefined;
	const questions = list(structured["questions"]);
	const starMapping = list(structured["starMapping"]);
	return {
		view: "interview",
		title: `Interview prep: ${postingTitle(role, company, "role")}`,
		summary: [
			text(structured["stage"], "interview"),
			`${questions.length} likely questions`,
			`${starMapping.length} STAR examples mapped`,
		].join(" · "),
		items: questions.map((entry) => {
			const question = rec(entry);
			const bridge = text(question["bridge"]);
			return {
				title: text(question["question"], "Question"),
				note:
					[`Source: ${text(question["source"], "general")}`, bridge !== "" ? `Bridge: ${bridge}` : ""]
						.filter((part) => part !== "")
						.join(" · ") || undefined,
			};
		}),
		markdown: text(structured["packMarkdown"]) || markdown,
		actions: [
			{ label: "Research the company", tool: "research-company", args: toolArgs(structured, "company") },
			// PortalFieldsInput takes no company/role keys (strict schema
			// rejects unknown keys), and this view holds no portal fields to
			// prefill, so the draft call goes out with defaults.
			{
				label: "Draft portal answers for this role",
				tool: "draft-application-answers",
				args: {},
			},
		],
	};
}

function mapTailoredCv(args: Rec, structured: Rec, markdown?: string): DashboardData {
	const coverage = list(structured["coverage"]);
	const matched = coverage.filter((entry) => rec(entry)["status"] === "matched").length;
	const bridged = coverage.filter((entry) => rec(entry)["status"] === "bridged").length;
	const gaps = coverage.filter((entry) => rec(entry)["status"] === "gap").length;
	// The cover-letter button reuses the tailor call's posting text (required
	// input). Recording needs both tailored files, which never co-exist in
	// this view, so no record shortcut is offered.
	return {
		view: "cv",
		title: `Tailored CV (${text(structured["slug"], "draft")})`,
		summary: [
			`${matched} matched · ${bridged} bridged · ${gaps} gaps`,
			`Puppeteer A4 render, target ${num(structured["pageLimit"]) ?? 2} pages`,
		].join(" · "),
		items: coverageItems(coverage),
		markdown,
		actions: [
			...(hasPostingText(args)
				? [{ label: "Draft the cover letter", tool: "generate-cover-letter", args: tailorLetterArgs(args) }]
				: []),
			{ label: "Prep the interview", tool: "prepare-interview", args: toolArgs(args, "company", "role") },
		],
	};
}

function mapCoverLetter(args: Rec, structured: Rec, markdown?: string): DashboardData {
	// Recording needs both tailored files, which never co-exist in this
	// view, so no record shortcut is offered.
	return {
		view: "letter",
		title: `Cover letter (${text(structured["slug"], "draft")})`,
		summary: [
			`${num(structured["wordCount"]) ?? "?"} words (band 250-300), Puppeteer A4 render`,
			`${text(structured["template"], "fixed template")} to exactly 1 page`,
		].join(" · "),
		items: coverageItems(structured["coverage"]),
		markdown,
		actions: [
			{ label: "Prep the interview", tool: "prepare-interview", args: toolArgs(args, "company", "role") },
		],
	};
}

function mapTrack(args: Rec, structured: Rec, markdown?: string): DashboardData {
	const { company, role } = companyRole(args);
	const action = text(structured["action"], "record");
	const hash = text(structured["trackerHash"]);
	const archiveFile = text(structured["archiveFile"]);
	return {
		view: "track",
		title: `Record application: ${action}`,
		summary: `${action === "append" ? "Appended" : "Updated"} tracker row${hash !== "" ? ` · hash ${hash.slice(0, 8)}` : ""}`,
		items: [
			{
				title: postingTitle(role, company, "Application"),
				note: archiveFile !== "" ? `Archive: ${archiveFile}` : text(structured["archiveNote"]) || undefined,
			},
		],
		markdown,
		actions: [
			{ label: "Prep the interview", tool: "prepare-interview", args: toolArgs(args, "company", "role") },
			{ label: "Check due follow-ups", tool: "due-followups" },
		],
	};
}

function mapStrategy(_args: Rec, structured: Rec, markdown?: string): DashboardData {
	const directions = list(structured["directions"]);
	const priorityGaps = strings(structured["priorityGaps"]);
	return {
		view: "strategy",
		title: "Career strategy",
		summary:
			priorityGaps.length > 0
				? `Priority gaps: ${priorityGaps.join("; ")}`
				: `${directions.length} grounded direction${directions.length === 1 ? "" : "s"}`,
		items: directions.map((entry) => {
			const direction = rec(entry);
			const why = strings(direction["why"]);
			const gapsToClose = strings(direction["gapsToClose"]);
			return {
				title: text(direction["direction"], "Direction"),
				note:
					[why[0] ?? "", gapsToClose.length > 0 ? `Gaps to close: ${gapsToClose.join("; ")}` : ""]
						.filter((part) => part !== "")
						.join(" · ") || undefined,
			};
		}),
		markdown,
		// No rank shortcut: rank-jobs requires caller-held backlog items and
		// the strategy view holds no postings, so that call would fail input
		// validation.
		actions: [
			...priorityGaps.map((gap) => ({
				label: `Search roles closing: ${gap}`,
				tool: "search-jobs",
				args: { keywords: gap },
			})),
		],
	};
}

function mapFields(_args: Rec, structured: Rec, markdown?: string): DashboardData {
	const intros = list(structured["selfIntros"]);
	const projects = list(structured["projectEntries"]);
	const pitches = list(structured["pitches"]);
	return {
		view: "answers",
		title: "Application answers",
		summary: `${intros.length} self-intros · ${projects.length} project entries · ${pitches.length} pitches`,
		items: [
			...intros.map((entry) => {
				const intro = rec(entry);
				const target = intro["targetWords"];
				const targetNote = typeof target === "number" ? ` (target ${target})` : "";
				const trim = text(intro["trimNote"]);
				return {
					title: `Self-intro (${text(intro["roleType"], "general")})`,
					note: `${num(intro["wordCount"]) ?? "?"} words${targetNote}${trim !== "" ? ` · ${trim}` : ""}`,
				};
			}),
			...pitches.map((entry) => {
				const pitch = rec(entry);
				return {
					title: `Pitch (${text(pitch["context"], "general")})`,
					note: `${num(pitch["charCount"]) ?? "?"} chars${pitch["recommended"] === true ? " · recommended" : ""}`,
				};
			}),
		],
		markdown: text(structured["copyPasteText"]) || markdown,
		// No record shortcut: track-application needs tailored files plus
		// company/role, and this view holds neither.
		actions: [],
	};
}

function mapResearch(_args: Rec, structured: Rec, markdown?: string): DashboardData {
	const claims = list(structured["claims"]);
	const sourcing = rec(structured["sourcing"]);
	return {
		view: "research",
		title: `Company research: ${text(structured["company"], "company")}`,
		summary: [
			structured["cached"] === true ? "Cache hit" : "Fresh research",
			`${claims.length} sourced claims`,
			`${num(sourcing["droppedCount"]) ?? 0} dropped`,
		].join(" · "),
		items: claims.map((entry) => {
			const claim = rec(entry);
			const url = text(claim["sourceUrl"]);
			return {
				title: text(claim["text"], "Claim"),
				url: url !== "" ? url : undefined,
				note: url !== "" ? `Sourced from ${url} (${text(claim["sourcedFrom"])})` : undefined,
			};
		}),
		markdown,
		// No next-step shortcuts: research-job needs a target role and
		// generate-cover-letter needs the posting text, and company research
		// holds neither. Both calls would fail input validation.
		actions: [],
	};
}

const RESEARCH_TOPIC_LABELS: Record<string, string> = {
	company: "Company",
	role: "Role",
	salary: "Salary",
	culture: "Culture",
	interview: "Interview",
	news: "News",
};

function mapJobResearch(args: Rec, structured: Rec, markdown?: string): DashboardData {
	const company = text(structured["company"]) || text(args["company"]) || undefined;
	const role = text(structured["role"]) || text(args["role"]) || undefined;
	const snapshot = list(structured["snapshot"]);
	const sourcing = rec(structured["sourcing"]);
	const briefMode = structured["briefMode"] === true;
	return {
		view: "brief",
		title: `Job brief: ${postingTitle(role, company, "role")}`,
		summary: [
			briefMode ? "Research brief — no findings yet" : `${snapshot.length} findings`,
			`${num(sourcing["sourcedCount"]) ?? 0} sourced`,
			`${strings(structured["redFlags"]).length} red flags`,
		].join(" · "),
		items: [
			...snapshot.map((entry) => {
				const finding = rec(entry);
				const url = text(finding["sourceUrl"]);
				const topic = text(finding["topic"]);
				const sourceLabel = text(finding["sourceLabel"]);
				return {
					title: text(finding["claim"], "Finding"),
					url: url !== "" ? url : undefined,
					note:
						[RESEARCH_TOPIC_LABELS[topic] ?? topic, sourceLabel].filter((part) => part !== "").join(" · ") ||
						undefined,
				};
			}),
			...strings(structured["fitNotes"]).map((note) => ({ title: note })),
			...strings(structured["redFlags"]).map((flag) => ({ title: flag, verdict: "Verify" })),
		],
		markdown,
		// Analyze runs on company+role alone (all analyze-job inputs are
		// optional). Tailoring is omitted: tailor-resume requires the posting
		// text and a job brief holds none, so that call would fail input
		// validation.
		actions: [
			{
				label: "Analyze this posting",
				tool: "analyze-job",
				args: {
					...(company ? { company } : {}),
					...(role ? { role } : {}),
				},
			},
		],
	};
}

function mapProfile(_args: Rec, structured: Rec, markdown?: string): DashboardData {
	const profile = rec(structured["profile"]);
	const unified = list(profile["skills"])
		.map((entry) => text(rec(entry)["name"]))
		.filter((name) => name !== "");
	const skills = unified.length > 0 ? unified : strings(profile["primarySkills"]);
	const keywords =
		strings(rec(profile["preferences"])["targetRoles"])[0] ?? skills[0] ?? "";
	const projects = list(profile["projects"]).flatMap((entry) => {
		const project = rec(entry);
		const name = text(project["name"]);
		if (name === "") return [];
		return [
			{
				title: name,
				note: excerpt(project["description"], DESCRIPTION_EXCERPT_LIMIT),
				url: text(project["url"]) || text(project["github"]) || undefined,
			},
		];
	});
	const experience = list(profile["experience"]).flatMap((entry) => {
		const role = rec(entry);
		const position = text(role["position"]);
		const company = text(role["company"]);
		const title = [position, company ? `at ${company}` : ""].filter((part) => part !== "").join(" ");
		if (title === "") return [];
		return [{ title, note: excerpt(role["description"], DESCRIPTION_EXCERPT_LIMIT) }];
	});
	return {
		view: "profile",
		title: "Profile setup",
		summary: [text(profile["name"]) || "Profile", text(profile["location"]), skills.length > 0 ? skills.join(", ") : "no primary skills yet"]
			.filter((part) => part !== "")
			.join(" · "),
		items: [...experience, ...projects],
		markdown,
		actions: [
			{ label: "Plan a career strategy", tool: "career-strategy" },
			...(keywords !== "" ? [{ label: `Search ${keywords} roles`, tool: "search-jobs", args: { keywords } }] : []),
		],
	};
}

function mapFollowups(_args: Rec, structured: Rec, markdown?: string): DashboardData {
	const due = list(structured["due"]);
	const checked = num(structured["checked"]) ?? due.length;
	return {
		view: "followups",
		title: "Due follow-ups",
		summary:
			due.length > 0
				? `${due.length} due of ${checked} checked`
				: "Nothing due. No open application is stale or near deadline.",
		items: due.map((entry) => {
			// No record shortcut: track-application requires the tailored
			// files plus company/role, and a follow-up row holds neither
			// file, so that call would fail input validation.
			const item = rec(entry);
			return {
				title: `${text(item["company"], "Company")} — ${text(item["role"], "role")}`,
				verdict: text(item["status"]) || undefined,
				note: `${text(item["reason"])} · Action: ${text(item["suggestedAction"])}`,
			};
		}),
		markdown,
		actions: [],
	};
}

export function mapToolToDashboard(
	toolName: string,
	args: unknown,
	structuredContent: unknown,
	textContent: string | null,
): DashboardData {
	const a = rec(args);
	const s = rec(structuredContent);
	let data: DashboardData;
	const markdown = typeof textContent === "string" && textContent.trim() !== "" ? textContent : undefined;
	switch (toolName) {
		case "analyze-job":
			data = mapAnalysis(a, s, markdown);
			break;
		case "tailor-resume":
			data = mapTailoredCv(a, s, markdown);
			break;
		case "generate-cover-letter":
			data = mapCoverLetter(a, s, markdown);
			break;
		case "track-application":
			data = mapTrack(a, s, markdown);
			break;
		case "prepare-interview":
			data = mapInterview(a, s, markdown);
			break;
		case "career-strategy":
			data = mapStrategy(a, s, markdown);
			break;
		case "draft-application-answers":
			data = mapFields(a, s, markdown);
			break;
		case "rank-jobs":
			data = mapRank(a, s, markdown);
			break;
		case "research-company":
			data = mapResearch(a, s, markdown);
			break;
		case "research-job":
			data = mapJobResearch(a, s, markdown);
			break;
		case "search-jobs":
			data = mapSearch(a, s, markdown);
			break;
		case "setup-profile":
			data = mapProfile(a, s, markdown);
			break;
		case "due-followups":
			data = mapFollowups(a, s, markdown);
			break;
		default:
			data = {
				view: TOOL_VIEWS[toolName] ?? "overview",
				title: TOOL_LABELS[toolName] ?? toolName,
				markdown,
			};
			break;
	}
	return Object.keys(s).length > 0 ? { ...data, details: data.details ?? s } : data;
}
