import { checkSourceConsistency, matchRequirements, archiveDirFor, checkGateSummary, wordOverlap } from "@/lib/job-hunter/tailor.ts";
import type { EvaluationSummary } from "@/lib/job-hunter/tailor.ts";
import { CONTENT_STOPWORDS } from "@/lib/job-hunter/tailor.ts";
import { sanitizeQuote, QUOTE_MAX_LENGTH, contentWords } from "@/lib/job-hunter/evaluate.ts";
import { EMPTY_SLUG_ERROR, makeJobSlug } from "@/lib/job-key.ts";
import { stripHtmlToProse } from "@/lib/job-hunter/verify.ts";
import { resolveProfile, evidencePool } from "@/lib/job-hunter/profile.ts";
import {
	adjacentDomainNames,
	careerTargetNames,
	primarySkillNames,
	secondarySkillNames,
	strongDomainNames,
} from "@/lib/job-hunter/profile.ts";

export const PREP_STAGES = [
	"recruiter-screen",
	"technical",
	"hiring-manager",
	"panel-onsite",
	"other",
] as const;

export type PrepStage = (typeof PREP_STAGES)[number];

const LOGISTICS_KEYS = ["dateTime", "format", "interviewers", "location"] as const;

export interface StarExample {
	title: string;
	situation: string;
	task: string;
	action: string;
	result: string;
	/** Tags naming the topics this example may be used for. */
	useFor: string[];
}

export interface PrepLogistics {
	dateTime?: string;
	format?: string;
	interviewers?: string;
	location?: string;
}

export interface PrepInput {
	company: string;
	role: string;
	stage?: string;
	/** Exact archived posting text; absent means an explicit fallback, never a guess. */
	postingText?: string;
	/** Submitted CV HTML or plain text for probeable-claim extraction. */
	cvText?: string;
	/** Submitted cover-letter HTML or plain text for probeable-claim extraction. */
	coverText?: string;
	/** Recorded feedback from earlier stages (tracker notes); never sibling-role history. */
	stageHistoryText?: string;
	starExamples?: StarExample[];
	/** Caller-verified company facts only; echoed verbatim, never invented. */
	companyFacts?: string[];
	logistics?: PrepLogistics;
	profile?: unknown;
	masterCvText?: string;
	workspaceProfileText?: string;
	/** Optional analyze-job summary; refused on FAIL, warned when missing. */
	evaluation?: EvaluationSummary;
}

export type QuestionSource = "recorded-feedback" | "fit-gap" | "posting-requirement" | "stage-type";

export interface LikelyQuestion {
	question: string;
	source: QuestionSource;
	/** Honest bridge phrasing for fit-gap sources; pivots to profile evidence. */
	bridge?: string;
	/** Profile phrase grounding the question or bridge. */
	evidence?: string;
}

export interface StarMapping {
	title: string;
	useFor: string[];
	covers: string[];
}

export interface StarDraft {
	title: string;
	situation: string;
	task: string;
	action: string;
	result: string;
	evidence: string[];
	needsCandidateDetail: true;
}

export interface PrepPlan {
	company: string;
	role: string;
	stage: PrepStage;
	slug: string;
	packFile: string;
	packMarkdown: string;
	missingLogistics: string[];
	fallbackNotes: string[];
	questions: LikelyQuestion[];
	starMapping: StarMapping[];
	uncoveredQuestions: string[];
	newStarDrafts: StarDraft[];
	probeableClaims: string[];
	toughQuestions: string[];
	questionsToAsk: string[];
	warnings: string[];
}

const CLAIM_PATTERN = /\d/;

/** Lines carrying document markup (TeX commands or HTML tags) take the cleaned-prose emission path. */
const MARKUP_HINT = /[\\{}<>]/;

const STAGE_BANKS: Record<string, { likely: string[]; ask: string[] }> = {
	"recruiter-screen": {
		likely: ["Walk me through your background in two minutes."],
		ask: ["What are the next steps and timeline for this process?"],
	},
	technical: {
		likely: ["Talk through a recent deep-dive technical problem you solved."],
		ask: [
			"What does the technical deep-dive cover, and how is it evaluated?",
			"What does the day-to-day technical stack look like?",
		],
	},
	"hiring-manager": {
		likely: ["How do you prioritize when everything is urgent?"],
		ask: ["What does success look like in the first 90 days?"],
	},
	"panel-onsite": {
		likely: ["Tell us about a disagreement with a teammate and how you resolved it."],
		ask: ["How does the team handle on-call and incident review?"],
	},
	other: {
		likely: ["Why are you interested in this role?"],
		ask: ["What should a strong candidate demonstrate at this stage?"],
	},
};

const TOUGH_BASE = [
	"What is your greatest weakness?",
	"What are your salary expectations?",
	"Tell me about a time you failed.",
];

/**
 * Stage-alias table: ordinary stage names resolve onto the five banks.
 * First match wins; several banks matching means ambiguity and is noted.
 * | raw wording              | bank             |
 * | phone screen, HR round   | recruiter-screen |
 * | system design, live code | technical        |
 * | hiring manager           | hiring-manager   |
 * | final round, panel       | panel-onsite     |
 */
const STAGE_ALIASES: Array<{ pattern: RegExp; stage: PrepStage }> = [
	{ pattern: /phone|recruiter|\bhr\b|human resources|screen|initial|intro|informal chat/, stage: "recruiter-screen" },
	{ pattern: /technical|coding|system design|take.home|live code|pair programming|architect|deep.dive|whiteboard|algorithm|debug/, stage: "technical" },
	{ pattern: /hiring.manager|\bhm\b|manager/, stage: "hiring-manager" },
	{ pattern: /panel|onsite|on.site|final|loop|group interview|team interview/, stage: "panel-onsite" },
];

function normalizeStage(raw: string | undefined, fallbackNotes: string[]): PrepStage {
	if (!raw) {
		return "other";
	}
	const stage = raw.toLowerCase();
	if ((PREP_STAGES as readonly string[]).includes(stage)) {
		return stage as PrepStage;
	}
	const hits = STAGE_ALIASES.filter((alias) => alias.pattern.test(stage)).map((alias) => alias.stage);
	const resolved = [...new Set(hits)];
	if (resolved.length === 1) {
		fallbackNotes.push(`Stage '${raw}' read as '${resolved[0]}'.`);
		return resolved[0] as PrepStage;
	}
	if (resolved.length > 1) {
		fallbackNotes.push(
			`Stage '${raw}' matches several banks (${resolved.join(", ")}); read as '${resolved[0]}' — confirm the right one.`,
		);
		return resolved[0] as PrepStage;
	}
	fallbackNotes.push(`Unknown stage '${raw}' treated as 'other'; stage banks stay generic.`);
	return "other";
}

function feedbackQuestions(stageHistoryText: string | undefined): LikelyQuestion[] {
	if (!stageHistoryText) {
		return [];
	}
	// The input is recorded caller-attested feedback (never verified): every
	// non-empty line becomes a capped, markup-stripped question labeled as
	// recorded data — never instructions, never sibling-role history.
	return stageHistoryText
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => {
			const cleaned = sanitizeQuote(line).slice(0, QUOTE_MAX_LENGTH);
			return {
				question: `Follow up on recorded feedback (caller-attested, never verified): ${cleaned}`,
				source: "recorded-feedback" as const,
			};
		});
}

function strongestEvidence(profile: ReturnType<typeof resolveProfile>): string {
	return (
		primarySkillNames(profile)[0] ??
		secondarySkillNames(profile)[0] ??
		strongDomainNames(profile)[0] ??
		careerTargetNames(profile)[0] ??
		"your core background"
	);
}

/**
 * Fit-gap evidence by word overlap (issue 19, same rule as the letter
 * bridge): the profile phrase sharing the most content words with the
 * gap wins; with no overlap the bridge says "no direct evidence"
 * instead of borrowing an unrelated skill.
 */
function gapEvidence(
	requirement: string,
	profile: ReturnType<typeof resolveProfile>,
): string | null {
	const candidates = [
		...primarySkillNames(profile),
		...secondarySkillNames(profile),
		...strongDomainNames(profile),
		...adjacentDomainNames(profile),
	];
	let best: string | null = null;
	let bestScore = 0;
	for (const candidate of candidates.map((entry) => (entry ?? "").trim()).filter(Boolean)) {
		const score = wordOverlap(requirement, candidate);
		if (score > bestScore) {
			bestScore = score;
			best = candidate;
		}
	}
	return best;
}

/**
 * Content words for Use-for tag overlap (shared floor keeps tags like
 * "SQL" usable, screened by the shared stopword list so filler words
 * such as "and", "the", or "for" inside a tag never count as coverage).
 */
function tagWords(text: string): Set<string> {
	return new Set([...contentWords(text)].filter((word) => !CONTENT_STOPWORDS.has(word)));
}

function coversQuestion(example: StarExample, question: string): boolean {
	const tags = new Set<string>();
	for (const tag of example.useFor) {
		for (const word of tagWords(tag)) {
			tags.add(word);
		}
	}
	for (const word of tagWords(question)) {
		if (tags.has(word)) {
			return true;
		}
	}
	return false;
}

/** Refused pack: no questions, no drafts, no save path — the refusal is the content. */
function refusedPlan(
	company: string,
	role: string,
	stage: PrepStage,
	slug: string,
	packFile: string,
	fallbackNotes: string[],
	refusal: string,
	guidance: string,
): PrepPlan {
	const packMarkdown = [
		`## Interview prep: ${role} at ${company} (${stage})`,
		"",
		`- Refused: ${refusal}`,
		"",
		guidance,
	].join("\n");
	return {
		company,
		role,
		stage,
		slug,
		packFile,
		packMarkdown,
		missingLogistics: ["dateTime", "format", "interviewers", "location"],
		fallbackNotes,
		questions: [],
		starMapping: [],
		uncoveredQuestions: [],
		newStarDrafts: [],
		probeableClaims: [],
		toughQuestions: [],
		questionsToAsk: [],
		warnings: [refusal],
	};
}
/**
 * Builds one interview-prep pack from caller-held facts only. The server is
 * stateless: the exact archived posting, submitted documents, and stage
 * history arrive as inputs, and every absence degrades to an explicit
 * fallback note. Nothing is ever pulled from sibling roles.
 */
export function planInterviewPrep(input: PrepInput): PrepPlan {
	const fallbackNotes: string[] = [];
	const slug = makeJobSlug(input.company, input.role);
	if (!slug) {
		const stage = normalizeStage(input.stage, fallbackNotes);
		fallbackNotes.push(EMPTY_SLUG_ERROR);
		return refusedPlan(
			input.company,
			input.role,
			stage,
			"",
			"",
			fallbackNotes,
			EMPTY_SLUG_ERROR,
			"No pack was built and no file path was issued.",
		);
	}
	const gate = checkGateSummary(input.evaluation);
	if (gate.refused) {
		const stage = normalizeStage(input.stage, fallbackNotes);
		const packFile = `${archiveDirFor(slug)}/${stage}-prep.md`;
		const refusal = gate.refused;
		fallbackNotes.push(refusal);
		return refusedPlan(
			input.company,
			input.role,
			stage,
			slug,
			packFile,
			fallbackNotes,
			refusal,
			"Pass the analyze-job verdict plus gate results as `evaluation`; prepping for a gate-failed posting is pure waste.",
		);
	}
	if (gate.note) {
		fallbackNotes.push(gate.note);
	}
	const stage = normalizeStage(input.stage, fallbackNotes);
	const profile = resolveProfile(input.profile);
	const packFile = `${archiveDirFor(slug)}/${stage}-prep.md`;

	const logistics = input.logistics ?? {};
	const missingLogistics = LOGISTICS_KEYS.filter(
		(key) => !logistics[key] || logistics[key].trim().length === 0,
	);

	const questions: LikelyQuestion[] = [];
	if (input.stageHistoryText) {
		questions.push(...feedbackQuestions(input.stageHistoryText));
	} else {
		fallbackNotes.push(
			"No stage history held; the question set starts from the posting and stage type (no sibling-role history consulted).",
		);
	}

	if (input.postingText) {
		const coverage = matchRequirements(input.postingText, profile);
		for (const match of coverage) {
			if (match.status !== "gap" && match.status !== "bridged") {
				continue;
			}
			const evidence = gapEvidence(match.requirement, profile);
			questions.push({
				question: `How would you handle ${match.requirement} given limited background?`,
				source: "fit-gap",
				bridge: evidence
					? `Name the limited ${match.requirement} exposure plainly, then bridge to ${evidence} and how you would close the gap in the first 90 days.`
					: `Name the limited ${match.requirement} exposure plainly; you have no direct evidence, so outline what you would do in the first 90 days without claiming background you lack.`,
				evidence: evidence ?? "no direct evidence",
			});
		}
		for (const match of coverage) {
			if (match.status !== "matched" || match.kind !== "essential") {
				continue;
			}
			questions.push({
				question: `Walk through your experience with ${match.requirement}.`,
				source: "posting-requirement",
				evidence: match.evidence,
			});
		}
	} else {
		fallbackNotes.push(
			"No archived posting held; likely questions come from stage history and stage type only (no requirements invented).",
		);
	}
	for (const likely of STAGE_BANKS[stage].likely) {
		questions.push({ question: likely, source: "stage-type" });
	}

	const examples = input.starExamples ?? [];
	const starMapping: StarMapping[] = examples.map((example) => ({
		title: example.title,
		useFor: example.useFor,
		covers: questions.filter((question) => coversQuestion(example, question.question)).map((q) => q.question),
	}));
	const covered = new Set(starMapping.flatMap((entry) => entry.covers));
	const uncoveredQuestions = questions
		.map((question) => question.question)
		.filter((question) => !covered.has(question));

	const newStarDrafts: StarDraft[] = [];
	for (const question of questions) {
		if (newStarDrafts.length >= 3) {
			break;
		}
		if (question.source !== "fit-gap" && question.source !== "posting-requirement") {
			continue;
		}
		if (covered.has(question.question)) {
			continue;
		}
		const evidence =
			question.evidence && question.evidence !== "no direct evidence"
				? question.evidence
				: strongestEvidence(profile);
		newStarDrafts.push({
			title: `STAR draft for: ${question.question}`,
			situation: `Draw from ${evidence} where applied`,
			task: `Describe concrete example with ${evidence}`,
			action: `Applied ${evidence} with that model`,
			result: "Quantify from your records before the interview.",
			evidence: [evidence],
			needsCandidateDetail: true,
		});
	}

	const submitted = [input.cvText, input.coverText].filter((text) => text && text.trim().length > 0);
	if (submitted.length === 0) {
		fallbackNotes.push("No submitted documents held; the probeable-claims list is empty.");
	}
	const probeableClaims: string[] = [];
	const pool = evidencePool(profile);
	for (const text of submitted as string[]) {
		// Submitted documents are usually generated HTML: run detection
		// over markup-stripped prose so \cventry lines read as content, but
		// emit the verbatim line for plain text and cleaned prose only when
		// markup was actually present.
		for (const rawLine of text.split(/\r?\n/)) {
			const trimmed = rawLine.trim();
			if (trimmed.length === 0) {
				continue;
			}
			const prose = stripHtmlToProse(trimmed).replace(/\s+/g, " ").trim();
			const quantified = CLAIM_PATTERN.test(prose);
			const checkable = pool.some((phrase) => prose.toLowerCase().includes(phrase.toLowerCase()));
			if (quantified || checkable) {
				probeableClaims.push(MARKUP_HINT.test(trimmed) ? prose : trimmed);
			}
		}
	}

	const facts = input.companyFacts ?? [];
	const toughQuestions = [...TOUGH_BASE];
	if (facts.length > 0) {
		toughQuestions.push(`Why ${input.company}? Anchor on a verified hook: ${facts[0]}`);
	} else {
		toughQuestions.push(`Why ${input.company}? (no verified company facts held — keep this generic)`);
		fallbackNotes.push("No verified company facts held; tough questions stay generic.");
	}

	const questionsToAsk = [...STAGE_BANKS[stage].ask];
	const warnings = checkSourceConsistency(profile, input.masterCvText, input.workspaceProfileText);

	const packMarkdown = renderPack({
		company: input.company,
		role: input.role,
		stage,
		packFile,
		missingLogistics,
		fallbackNotes,
		questions,
		starMapping,
		uncoveredQuestions,
		newStarDrafts,
		probeableClaims,
		toughQuestions,
		questionsToAsk,
		warnings,
	});

	return {
		company: input.company,
		role: input.role,
		stage,
		slug,
		packFile,
		packMarkdown,
		missingLogistics: [...missingLogistics],
		fallbackNotes,
		questions,
		starMapping,
		uncoveredQuestions,
		newStarDrafts,
		probeableClaims,
		toughQuestions,
		questionsToAsk,
		warnings,
	};
}

function renderPack(plan: {
	company: string;
	role: string;
	stage: string;
	packFile: string;
	missingLogistics: string[];
	fallbackNotes: string[];
	questions: LikelyQuestion[];
	starMapping: StarMapping[];
	uncoveredQuestions: string[];
	newStarDrafts: StarDraft[];
	probeableClaims: string[];
	toughQuestions: string[];
	questionsToAsk: string[];
	warnings: string[];
}): string {
	const lines = [
		`## Interview prep: ${plan.role} at ${plan.company} (${plan.stage})`,
		"",
		`- Save this pack to \`${plan.packFile}\` (host owns the write).`,
		...(plan.missingLogistics.length > 0
			? [`- Missing stage logistics — ask the candidate: ${plan.missingLogistics.join(", ")}.`]
			: ["- Stage logistics complete."]),
		"",
		"### Likely questions (feedback first, then fit gaps, posting, stage)",
		...plan.questions.map(
			(question, index) =>
				`${index + 1}. [${question.source}] ${question.question}${question.bridge ? ` Bridge: ${question.bridge}` : ""}`,
		),
		"",
		"### STAR mapping (existing examples by Use-for tags)",
		...(plan.starMapping.length > 0
			? plan.starMapping.map(
					(entry) =>
						`- ${entry.title} (${entry.useFor.join(", ") || "untagged"}): ${entry.covers.length > 0 ? entry.covers.join(" | ") : "covers nothing — retag or retire"}`,
				)
			: ["- No STAR examples held; drafts below seed the bank."]),
		...(plan.uncoveredQuestions.length > 0
			? ["", "### Uncovered questions", ...plan.uncoveredQuestions.map((question) => `- ${question}`)]
			: []),
		...(plan.newStarDrafts.length > 0
			? [
					"",
					"### New STAR drafts (profile facts only — add your specifics)",
					...plan.newStarDrafts.flatMap((draft) => [
						`- ${draft.title}`,
						`  Situation: ${draft.situation}`,
						`  Task: ${draft.task}`,
						`  Action: ${draft.action}`,
						`  Result: ${draft.result}`,
					]),
				]
			: []),
		"",
		"### Probeable claims (keep answers consistent with the submitted documents)",
		...(plan.probeableClaims.length > 0
			? plan.probeableClaims.map((claim) => `- Be ready to evidence: ${claim}`)
			: ["- None held."]),
		"",
		"### Tough questions",
		...plan.toughQuestions.map((question) => `- ${question}`),
		"",
		"### Questions to ask",
		...plan.questionsToAsk.map((question) => `- ${question}`),
		"",
		"### Fallbacks and warnings",
		...(plan.fallbackNotes.length > 0 ? plan.fallbackNotes.map((note) => `- ${note}`) : ["- None."]),
		...plan.warnings.map((warning) => `- Warning: ${warning}`),
		"",
		"Mock run: ask the host to run a mock interview over these questions, coached toward the candidate's natural register.",
	];
	return lines.join("\n");
}
