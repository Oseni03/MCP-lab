import type { Profile } from "@/lib/job-hunter/profile.ts";
import {
	adjacentDomainNames,
	careerTargetNames,
	matchingPool,
	primarySkillNames,
	secondarySkillNames,
	strongDomainNames,
} from "@/lib/job-hunter/profile.ts";

export type EligibilityVerdict = "PASS" | "FAIL" | "PROCEED_UNVERIFIED";
export type LanguageVerdict = "PASS" | "FAIL" | "FLAG";

export interface GateResult<TVerdict extends string> {
	verdict: TVerdict;
	/** Exact posting line that triggered the verdict, when one matched. */
	quote?: string;
	note: string;
}

const CITIZENSHIP_PATTERNS = [
	/must be (a )?citizens? of/i,
	/citizenship (is )?required/i,
	/(only )?(citizens|permanent residents)( of| may| can| need)?/i,
	/permanent residen\w* (required|is required|essential)/i,
	/\bPR required\b/i,
	/full working rights/i,
];

const CLEARANCE_PATTERNS = [
	/security clearance/i,
	/security[-\s]?cleared/i,
	/\bSC cleared\b/i,
	/\bDV cleared\b/i,
	/must hold .*clearance/i,
];

const WELCOME_PATTERNS = [
	/international applicants/i,
	/visa holders considered/i,
	/we sponsor/i,
	/sponsorship (available|offered|considered|provided)/i,
];

/**
 * Quote hygiene cap (issue 15). One constant applied everywhere quotes are
 * emitted — gate quotes, strength/gap evidence, research notes, prep
 * feedback — not just the fallback path. Quoted posting data is untrusted
 * third-party text: truncated, stripped of live markup, and always labeled
 * as quoted data at the render layer, never as instructions.
 */
export const QUOTE_MAX_LENGTH = 280;

/**
 * Strips live markup from quoted posting text: HTML tags, markdown links
 * `[text](url)` → `text`, fence characters, and collapses whitespace.
 * Truncates to QUOTE_MAX_LENGTH. Never throws.
 */
export function sanitizeQuote(raw: string): string {
  const withoutHtml = raw.replace(/<[^>]+>/g, " ");
  const withoutLinks = withoutHtml.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  const withoutFences = withoutLinks.replace(/```/g, "").replace(/[`*_]{1,3}/g, "");
  const collapsed = withoutFences.replace(/\s+/g, " ").trim();
  return collapsed.slice(0, QUOTE_MAX_LENGTH);
}

/** The posting line containing the match, trimmed and sanitized; whole text when single-line. */
function quoteLine(text: string, matchIndex: number): string {
  const lines = text.split(/\r?\n/);
  let offset = 0;
  for (const line of lines) {
    if (matchIndex >= offset && matchIndex < offset + line.length + 1) {
      return sanitizeQuote(line.trim());
    }
    offset += line.length + 1;
  }
  return sanitizeQuote(text.trim());
}

function firstMatch(text: string, patterns: RegExp[]): { quote: string } | null {
	for (const pattern of patterns) {
		pattern.lastIndex = 0;
		const match = pattern.exec(text);
		if (match && match.index !== undefined) {
			return { quote: quoteLine(text, match.index) };
		}
	}
	return null;
}

/**
 * Negation and vacuous-scope guard (issue 16). A line matching a FAIL
 * pattern is only an explicit stated requirement when it carries neither
 * a negation ("no", "not", "n't", "without", "waived", ...) nor a vacuous
 * scope ("of any country", "regardless of citizenship", ...). Negated or
 * vacuous matches are ambiguous: a human must judge, so they downgrade to
 * PROCEED_UNVERIFIED with the quoted line instead of stopping the pipeline
 * dead with a FAIL.
 */
const NEGATION_CONTEXT = /\b(no|not|n't|never|without|don't|doesn't|didn't|isn't|aren't|wasn't|weren't|waived|waive|waives|waiving|exempt|exempts|no longer)\b/i;
const VACUOUS_SCOPE = /\bof any countr|\bany nationalit|\bregardless of (citizenship|nationality)\b/i;

interface GateScan {
	quote: string;
	/** True when the match sits in negated or vacuous-scope wording (ambiguous, human judges). */
	negated: boolean;
}

/** Line-scoped gate scan: first explicit match wins; otherwise the first ambiguous match. */
function scanGateLines(text: string, patterns: RegExp[]): GateScan | null {
	let ambiguous: GateScan | null = null;
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line === "") {
			continue;
		}
		for (const pattern of patterns) {
			pattern.lastIndex = 0;
			if (!pattern.test(line)) {
				continue;
			}
			const quote = sanitizeQuote(line);
			if (NEGATION_CONTEXT.test(line) || VACUOUS_SCOPE.test(line)) {
				ambiguous ??= { quote, negated: true };
			} else {
				return { quote, negated: false };
			}
		}
	}
	return ambiguous;
}

/**
 * Eligibility Gate — hard filter before scoring (04-job-evaluation.md).
 * FAIL stops: quote the exact wording. Silence is not permission:
 * PROCEED_UNVERIFIED with a role-level check on the employer's own pages.
 */
export function checkEligibility(
	postingText: string,
	profile: Profile,
): GateResult<EligibilityVerdict> {
	const citizenship = scanGateLines(postingText, CITIZENSHIP_PATTERNS);
	if (citizenship && !citizenship.negated) {
		return {
			verdict: "FAIL",
			quote: citizenship.quote,
			note: "Posting states a citizenship or residency requirement. Do not score or draft; report the quoted wording to the user.",
		};
	}
	const clearance = scanGateLines(postingText, CLEARANCE_PATTERNS);
	if (clearance && !clearance.negated) {
		return {
			verdict: "FAIL",
			quote: clearance.quote,
			note: "Posting requires a security clearance, which is normally gated on citizenship. Verify the specific scheme before ruling the role out entirely; report the quoted wording to the user.",
		};
	}

	const namedPermit = profile.permitClasses.find((permit) =>
		permit !== "" && postingText.toLowerCase().includes(permit.toLowerCase()),
	);
	if (namedPermit) {
		return {
			verdict: "PASS",
			quote: quoteLine(postingText, postingText.toLowerCase().indexOf(namedPermit.toLowerCase())),
			note: `Posting explicitly names the candidate's permit class (${namedPermit}). Verified acceptance.`,
		};
	}

	const welcome = firstMatch(postingText, WELCOME_PATTERNS);
	if (welcome) {
		return {
			verdict: "PASS",
			quote: welcome.quote,
			note: "Posting explicitly welcomes international applicants or offers sponsorship.",
		};
	}

	const ambiguous = citizenship?.negated ? citizenship : clearance?.negated ? clearance : null;
	if (ambiguous) {
		return {
			verdict: "PROCEED_UNVERIFIED",
			quote: ambiguous.quote,
			note: "Posting mentions citizenship or clearance only in negated or vacuous-scope wording — ambiguous, not an explicit requirement. A human must judge the quoted line; check the employer's own careers or international-applicant page for a role-level decision before drafting.",
		};
	}

	return {
		verdict: "PROCEED_UNVERIFIED",
		note: "Posting is silent on citizenship and residency. Silence is not permission: check the employer's own careers or international-applicant page for a role-level decision before drafting, especially for professional services, government/defence, banking, telecom, or critical infrastructure.",
	};
}

const LEVEL_RANKS: Array<[RegExp, number]> = [
	[/\ba1\b/i, 1],
	[/\ba2\b/i, 2],
	[/\bb1\b/i, 3],
		[/conversational/i, 3],
	[/\bb2\b/i, 4],
	[/professional/i, 5],
	[/business[-\s]?level/i, 5],
	[/\bc1\b/i, 6],
	[/fluent/i, 6],
	[/\bc2\b/i, 7],
	[/native/i, 8],
];

const KNOWN_LANGUAGES = [
	"English",
	"Danish",
	"German",
	"French",
	"Spanish",
	"Swedish",
	"Norwegian",
	"Dutch",
	"Polish",
	"Russian",
	"Ukrainian",
	"Italian",
	"Portuguese",
	"Arabic",
	"Turkish",
	"Chinese",
	"Mandarin",
	"Cantonese",
	"Japanese",
	"Korean",
	"Hindi",
	"Urdu",
	"Bengali",
	"Finnish",
	"Icelandic",
	"Greek",
	"Czech",
	"Slovak",
	"Hungarian",
	"Romanian",
	"Bulgarian",
	"Croatian",
	"Serbian",
	"Slovenian",
	"Lithuanian",
	"Latvian",
	"Estonian",
	"Hebrew",
	"Persian",
	"Farsi",
	"Thai",
	"Vietnamese",
	"Indonesian",
	"Malay",
	"Tagalog",
	"Swahili",
	"Catalan",
	"Basque",
	"Galician",
	"Welsh",
	"Irish",
	"Gaelic",
	"Maltese",
	"Luxembourgish",
	"Frisian",
	"Faroese",
	"Greenlandic",
	"Albanian",
	"Macedonian",
	"Bosnian",
	"Belarusian",
	"Georgian",
	"Armenian",
	"Azerbaijani",
	"Kazakh",
	"Nepali",
	"Tamil",
	"Telugu",
	"Malayalam",
	"Kannada",
	"Marathi",
	"Gujarati",
	"Punjabi",
	"Sinhala",
	"Burmese",
	"Khmer",
	"Lao",
	"Mongolian",
	"Amharic",
	"Somali",
	"Yoruba",
	"Hausa",
	"Zulu",
	"Afrikaans",
];

const REQUIREMENT_CONTEXT = /requir|essential|must|mandatory|fluent|proficient|native|needed|plus\b|desirable/i;

function rankOf(levelText: string): number | null {
	let rank: number | null = null;
	for (const [pattern, value] of LEVEL_RANKS) {
		if (pattern.test(levelText)) {
			rank = rank === null ? value : Math.max(rank, value);
		}
	}
	return rank;
}

interface LanguageRequirement {
	language: string;
	line: string;
	barRank: number | null;
}

/**
 * Company-history context that mentions a language-named nationality without
 * stating a requirement ("founded by Danish engineers", "headquartered in
 * Berlin"): skipped so history never gates a candidate (issue 12 ride-along).
 */
const NEGATIVE_LANGUAGE_CONTEXT = /founded|headquarter(?:ed|s)?/i;

/** Languages required as a job condition: named language on a requirement-context line. */
function extractLanguageRequirements(postingText: string): LanguageRequirement[] {
	const found: LanguageRequirement[] = [];
	for (const rawLine of postingText.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || !REQUIREMENT_CONTEXT.test(line)) {
			continue;
		}
		if (NEGATIVE_LANGUAGE_CONTEXT.test(line)) {
			continue;
		}
		for (const language of KNOWN_LANGUAGES) {
			if (new RegExp(`\\b${language}\\b`, "i").test(line)) {
				found.push({ language, line, barRank: rankOf(line) });
			}
		}
	}
	return found;
}

/**
 * Language Gate — hard filter before scoring (04-job-evaluation.md).
 * Undeclared required language FAILs. A plausibly higher bar FLAGs with
 * both the posting requirement and the declared level quoted, then proceeds.
 */
export function checkLanguage(postingText: string, profile: Profile): GateResult<LanguageVerdict> {
	const requirements = extractLanguageRequirements(postingText);
	if (requirements.length === 0) {
		return { verdict: "PASS", note: "No explicit language requirement stated for the role." };
	}

	const declared = new Map(
		profile.languages.map((entry) => [entry.language.toLowerCase(), entry.level]),
	);

	for (const req of requirements) {
		const declaredLevel = declared.get(req.language.toLowerCase());
		if (declaredLevel === undefined) {
			return {
				verdict: "FAIL",
				quote: req.line,
				note: `${req.language} is required as a job condition but is not on the candidate's Languages table. Do not score or draft.`,
			};
		}
		if (req.barRank !== null) {
			const haveRank = rankOf(declaredLevel);
			if (haveRank === null || req.barRank > haveRank) {
				return {
					verdict: "FLAG",
					quote: req.line,
					note: `Posting bar may exceed the declared level (${req.language}: ${declaredLevel}). Score and draft normally, but surface this gap so the candidate can judge it.`,
				};
			}
		}
	}
	return { verdict: "PASS", note: "Stated language requirements are within declared levels." };
}

export type LocationStatus = "PASS" | "FAIL" | "FLAG";

export interface DimensionScore {
	dimension: "technical" | "experience" | "behavioral" | "location" | "career";
	/** 0-100 for scored dimensions; null for location (pass/fail, unweighted). */
	score: number | null;
	status?: LocationStatus;
	notes: string;
}

export const WEIGHTS = {
	technical: 0.3,
	experience: 0.25,
	behavioral: 0.15,
	career: 0.3,
} as const;

function normalized(text: string): string {
	return text.toLowerCase();
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Small directional alias map for skill matching (issue 12). True synonyms
 * resolve bidirectionally (K8s/Kubernetes, JS/JavaScript, TS/TypeScript,
 * Postgres/PostgreSQL). Generic SQL is deliberately NOT an alias of
 * Postgres: SQL is broader, so a bare "SQL" phrase must not claim a
 * Postgres-specific posting through substring overlap.
 */
export const SKILL_ALIASES: Record<string, string[]> = {
	k8s: ["kubernetes"],
	kubernetes: ["k8s"],
	js: ["javascript"],
	javascript: ["js"],
	ts: ["typescript"],
	typescript: ["ts"],
	postgres: ["postgresql"],
	postgresql: ["postgres"],
};

/**
 * Word-boundary phrase matching with a short-token guard (issue 12). Edges
 * treat `[a-z0-9+#]` as word characters, so tokens of length <= 2 (Go, R,
 * JS, TS, C++) only match exact tokens: "Go" matches "Go developer" but
 * not "Good", "Django", or "Goals". Multi-word phrases match on flexible
 * whitespace ("machine   learning").
 */
export function phraseMatches(text: string, phrase: string): boolean {
	const normalizedPhrase = phrase.trim().toLowerCase();
	if (normalizedPhrase === "") {
		return false;
	}
	const variants = [normalizedPhrase, ...(SKILL_ALIASES[normalizedPhrase] ?? [])];
	for (const variant of variants) {
		const escaped = escapeRegExp(variant).replace(/\s+/g, "\\s+");
		if (new RegExp(`(?<![a-z0-9+#])${escaped}(?![a-z0-9+#])`, "i").test(text)) {
			return true;
		}
	}
	return false;
}

/**
 * Shared content-word floor (issues 12/24, owned by the matching work).
 * Splits on non-word characters (keeping `+#` inside tokens so C++/C#
 * survive) and keeps tokens of length 3+, so short skill nouns like "SQL"
 * stay usable. Stopword screening is the caller's job — prep screens the
 * shared stopword list, strategy screens those plus its generic role
 * vocabulary — so the floor itself stays single-sourced for both consumers.
 */
export function contentWords(text: string): Set<string> {
	return new Set(
		text
			.toLowerCase()
			.split(/[^a-z0-9+#]+/)
			.filter((word) => word.length >= 3),
	);
}

/**
 * True when the profile carries anything to score against: skills, domains,
 * behavioral tasks, or career targets. Without any of these every dimension
 * falls back to 50 and all postings score an identical, invented 50 — so
 * callers must withhold the score instead (see evaluateJob).
 */
export function profileHasScoringSignal(profile: Profile): boolean {
	return (
		primarySkillNames(profile).some((s) => s.trim() !== "") ||
		secondarySkillNames(profile).some((s) => s.trim() !== "") ||
		strongDomainNames(profile).some((d) => d.trim() !== "") ||
		adjacentDomainNames(profile).some((d) => d.trim() !== "") ||
		profile.energizingTasks.some((t) => t.trim() !== "") ||
		profile.drainingTasks.some((t) => t.trim() !== "") ||
		careerTargetNames(profile).some((g) => g.trim() !== "")
	);
}

/** Recommendation when scoring is withheld for lack of profile signal. */
export const UNSET_PROFILE_RECOMMENDATION =
	"Profile not set up yet: add skills, domains, and target roles via setup-profile, then re-run — any score without them would be invented.";

/** Fraction of phrases present in the posting, full weight for primary, half for secondary. */
function coverage(posting: string, primary: string[], secondary: string[]): number | null {
	const primaryHits = primary.filter((p) => p !== "" && phraseMatches(posting, p));
	const secondaryHits = secondary.filter((s) => s !== "" && phraseMatches(posting, s));
	const denom = primary.length + 0.5 * secondary.length;
	if (denom === 0) {
		return null;
	}
	return Math.round((100 * (primaryHits.length + 0.5 * secondaryHits.length)) / denom);
}

/**
 * Five scoring dimensions (04-job-evaluation.md). Heuristic v0: deterministic
 * keyword coverage against the profile, so results are stable and testable.
 * Location is pass/fail and never weighted.
 */
export function scoreDimensions(postingText: string, profile: Profile): DimensionScore[] {
	const technical = coverage(postingText, primarySkillNames(profile), secondarySkillNames(profile));
	const experience = coverage(postingText, strongDomainNames(profile), adjacentDomainNames(profile));

	let behavioral: number | null = null;
	if (profile.energizingTasks.length > 0 || profile.drainingTasks.length > 0) {
		const energizing = profile.energizingTasks.filter((t) => t !== "" && phraseMatches(postingText, t));
		const draining = profile.drainingTasks.filter((t) => t !== "" && phraseMatches(postingText, t));
		behavioral = Math.max(0, Math.min(100, 50 + 10 * energizing.length - 15 * draining.length));
	}

	const targets = careerTargetNames(profile);
	const career =
		targets.length > 0
			? Math.round(
					(100 * targets.filter((g) => g !== "" && phraseMatches(postingText, g)).length) /
						targets.length,
				)
			: null;

	let location: LocationStatus = "PASS";
	let locationNotes = "Verify the commute against the candidate's location.";
	if (/relocat/i.test(postingText)) {
		location = "FAIL";
		locationNotes = "Posting requires relocation (deal-breaker).";
	} else if (/international travel|frequent travel|travel \d+%/i.test(postingText)) {
		location = "FLAG";
		locationNotes = "Posting involves significant travel; discuss with the candidate.";
	} else if (/remote|hybrid/i.test(postingText)) {
		locationNotes = "Remote/hybrid arrangement stated; confirm the exact onsite expectation.";
	}

	const setupNote = "Profile not set up yet; run /setup for a real score.";
	const primaries = primarySkillNames(profile);
	return [
		{
			dimension: "technical",
			score: technical ?? 50,
			notes:
				technical === null
					? setupNote
					: `${primaries.filter((p) => phraseMatches(postingText, p)).length}/${primaries.length} primary skills mentioned.`,
		},
		{
			dimension: "experience",
			score: experience ?? 50,
			notes:
				experience === null
					? setupNote
					: "Matched on the function and nature of the work, not literal job titles.",
		},
		{
			dimension: "behavioral",
			score: behavioral ?? 50,
			notes: behavioral === null ? setupNote : "Energizing tasks add, draining tasks subtract.",
		},
		{ dimension: "location", score: null, status: location, notes: locationNotes },
		{
			dimension: "career",
			score: career ?? 50,
			notes: career === null ? setupNote : "Coverage of stated target roles in the posting.",
		},
	];
}

/**
 * Posting date parsing with YYYY-MM-DD priority and relative-date support
 * (issue 12). Absolute dates win when present; otherwise day-exact relative
 * phrases ("today", "yesterday", "N days ago", "last week", "N weeks ago")
 * resolve against the injected `now`. Month-length-ambiguous phrases ("last
 * month") and anything unparseable stay unknown (null): never guessed.
 */
export function parsePostingDay(value: string | null | undefined, now: Date = new Date()): string | null {
	if (!value) {
		return null;
	}
	const trimmed = value.trim();
	const iso = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
	if (iso) {
		const day = iso[1];
		return Number.isNaN(new Date(`${day}T00:00:00Z`).getTime()) ? null : day;
	}
	const lower = trimmed.toLowerCase();
	const dayMs = 86400000;
	const utcDay = (time: number): string => new Date(time).toISOString().slice(0, 10);
	if (/\btoday\b/.test(lower)) {
		return utcDay(now.getTime());
	}
	if (/\byesterday\b/.test(lower) || /\ba\s+day\s+ago\b/.test(lower)) {
		return utcDay(now.getTime() - dayMs);
	}
	const daysAgo = /(\d+)\s+days?\s+ago/.exec(lower);
	if (daysAgo) {
		return utcDay(now.getTime() - Number.parseInt(daysAgo[1], 10) * dayMs);
	}
	if (/\blast\s+week\b/.test(lower) || /\ba\s+week\s+ago\b/.test(lower)) {
		return utcDay(now.getTime() - 7 * dayMs);
	}
	const weeksAgo = /(\d+)\s+weeks?\s+ago/.exec(lower);
	if (weeksAgo) {
		return utcDay(now.getTime() - Number.parseInt(weeksAgo[1], 10) * 7 * dayMs);
	}
	return null;
}

/** Weighted average of the four scored dimensions; location is never weighted. */
export function overallScore(dims: DimensionScore[]): number {
	let total = 0;
	for (const dim of dims) {
		if (dim.score === null || dim.dimension === "location") {
			continue;
		}
		total += WEIGHTS[dim.dimension] * dim.score;
	}
	return Math.round(total);
}

export type Verdict = "Strong Fit" | "Good Fit" | "Moderate Fit" | "Weak Fit" | "Poor Fit";

export function verdictFor(score: number): Verdict {
	if (score >= 75) {
		return "Strong Fit";
	}
	if (score >= 60) {
		return "Good Fit";
	}
	if (score >= 45) {
		return "Moderate Fit";
	}
	if (score >= 30) {
		return "Weak Fit";
	}
	return "Poor Fit";
}

/** Content vocabulary of the profile: words of length 2+ from skills, domains, goals, and extracted Evidence (never energizers). */
export function profileVocabulary(profile: Profile): Set<string> {
	const words = new Set<string>();
	for (const phrase of matchingPool(profile)) {
		for (const word of normalized(phrase).split(/[^a-z0-9+#]+/)) {
			if (word.length >= 2) {
				words.add(word);
			}
		}
	}
	return words;
}

/** Profile skills and domains mentioned in the posting (max 5). */
export function extractStrengths(postingText: string, profile: Profile): string[] {
	const strengths: string[] = [];
	for (const skill of [...primarySkillNames(profile), ...strongDomainNames(profile)]) {
		if (skill !== "" && phraseMatches(postingText, skill)) {
			strengths.push(sanitizeQuote(skill));
		}
		if (strengths.length >= 5) {
			break;
		}
	}
	return strengths;
}

const STOPWORDS = new Set([
	"with",
	"from",
	"that",
	"have",
	"will",
	"role",
	"work",
	"team",
	"experience",
	"years",
	"year",
	"requirements",
	"required",
	"essential",
	"desirable",
	"ability",
	"strong",
	"good",
	"plus",
	"including",
	"within",
	"their",
	"them",
	"such",
	"than",
	"then",
	"when",
	"also",
	"into",
]);

/** Distinctive requirement-line tokens absent from the profile (max 5, by frequency). */
export function extractGaps(postingText: string, profile: Profile): string[] {
	const vocab = profileVocabulary(profile);
	const counts = new Map<string, number>();
	for (const rawLine of postingText.split(/\r?\n/)) {
		if (!/requir|essential|desirable|nice.to.have|must have|plus\b/i.test(rawLine)) {
			continue;
		}
		for (const token of normalized(rawLine).split(/[^a-z0-9+#]+/)) {
			if (token.length >= 4 && !STOPWORDS.has(token) && !vocab.has(token)) {
				counts.set(token, (counts.get(token) ?? 0) + 1);
			}
		}
	}
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, 5)
		.map(([token]) => sanitizeQuote(token));
}

export function recommendationFor(verdict: Verdict): string {
	switch (verdict) {
		case "Strong Fit":
			return "Definitely apply; tailor the CV and cover letter to this role.";
		case "Good Fit":
			return "Apply, and address the listed gaps explicitly in the cover letter.";
		case "Moderate Fit":
			return "Consider carefully and discuss with the candidate before applying.";
		case "Weak Fit":
			return "Probably skip unless there are strategic reasons to apply.";
		case "Poor Fit":
			return "Skip this role.";
	}
}

/**
 * Unverified-eligibility caveat (issue 16). When eligibility is
 * PROCEED_UNVERIFIED, the employer's-own-page homework must travel with
 * the recommendation into drafting — a bare "Definitely apply" would read
 * as cleared. Applied as a prefix so it cannot be silently dropped.
 */
export const UNVERIFIED_ELIGIBILITY_CAVEAT =
	"Eligibility unverified — confirm work authorization on the employer's own careers or international-applicant page before drafting.";

export function withEligibilityCaveat(recommendation: string, eligibility: EligibilityVerdict): string {
	if (eligibility !== "PROCEED_UNVERIFIED") {
		return recommendation;
	}
	if (recommendation.startsWith(UNVERIFIED_ELIGIBILITY_CAVEAT)) {
		return recommendation;
	}
	return `${UNVERIFIED_ELIGIBILITY_CAVEAT} ${recommendation}`;
}

/** Finalizes a recommendation against the final eligibility: adds the caveat when unverified, strips a stale one when cleared. */
export function finalizeRecommendation(recommendation: string, eligibility: EligibilityVerdict): string {
	if (eligibility === "PROCEED_UNVERIFIED") {
		return withEligibilityCaveat(recommendation, eligibility);
	}
	const prefix = `${UNVERIFIED_ELIGIBILITY_CAVEAT} `;
	return recommendation.startsWith(prefix) ? recommendation.slice(prefix.length) : recommendation;
}

export interface EmployerCall {
	suggest: boolean;
	reason: string;
}

const CONTACT_PATTERNS = [
	/contact \w+/i,
	/questions\??.{0,60}(contact|call|reach out|get in touch)/i,
	/happy to (help|answer|discuss)/i,
	/please (call|contact)/i,
];

const VAGUE_PATTERNS = [
	/various tasks/i,
	/to be defined/i,
	/\bTBD\b/,
	/details (to follow|tbd)/i,
	/diverse tasks/i,
	/flexible role/i,
];

/** Only suggest calling when there are substantive questions — never just to be remembered. */
export function shouldCallEmployer(postingText: string): EmployerCall {
	if (CONTACT_PATTERNS.some((pattern) => pattern.test(postingText))) {
		return {
			suggest: true,
			reason: "A named contact invites questions about the role.",
		};
	}
	if (VAGUE_PATTERNS.some((pattern) => pattern.test(postingText))) {
		return {
			suggest: true,
			reason: "The posting is vague about day-to-day tasks; clarify before drafting.",
		};
	}
	const hasRequirements = /requir|essential/i.test(postingText);
	const hasSplit = /desirable|nice.to.have/i.test(postingText);
	if (hasRequirements && !hasSplit) {
		return {
			suggest: false,
			reason: "Posting lists requirements without an essential/desirable split, but is specific enough to draft from.",
		};
	}
	return { suggest: false, reason: "Posting is specific; no substantive questions identified." };
}

const DEADLINE_PATTERN =
	/(apply by|deadline|closing date|closes?( on| at)?|applications close)\s*:?\s*(\d{1,2}[./-]\d{1,2}([./-]\d{2,4})?|[A-Z][a-z]+ \d{1,2}(,? \d{4})?|\d{1,2} [A-Z][a-z]+( \d{4})?)/i;

/** Extracts the stated application deadline, if any. */
export function extractDeadline(postingText: string): string | null {
	const match = DEADLINE_PATTERN.exec(postingText);
	if (!match) {
		return null;
	}
	return match[3].replace(/,$/, "").trim();
}

const MONTH_NAMES: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
};

/**
 * Conservative fresh-deadline gate (issue 15). Accepts a fresh deadline
 * over the stored one solely for explicit-year, unambiguous formats:
 *
 * - Assumed-year rule: yearless phrases ("Apply by May 5") assume the
 *   current year via `new Date` — rejected, keep stored + note.
 * - Month-order rule: numeric `04/05` / `04-05` forms are ambiguous
 *   (US month order assumed by `new Date`) — rejected unless ISO
 *   `YYYY-MM-DD`, keep stored + note.
 * - UTC-day rule: `new Date(raw).toISOString()` can shift the day for
 *   non-UTC midnight offsets — so month-name forms are parsed manually
 *   to YYYY-MM-DD without a Date timezone shift; anything with a time
 *   or zone component is rejected, keep stored + note.
 *
 * Accepted: ISO `YYYY-MM-DD` and month-name forms with an explicit
 * 4-digit year (`May 5, 2026`, `5 May 2026`). Everything else returns
 * null (keep stored, add a note).
 */
export function parseConservativeDeadline(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  if (!/\b(19|20)\d{2}\b/.test(trimmed)) {
    return null;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (iso) {
    const day = `${iso[1]}-${iso[2]}-${iso[3]}`;
    return Number.isNaN(new Date(`${day}T00:00:00Z`).getTime()) ? null : day;
  }
  if (/\d{1,2}[:.]\d{2}/.test(trimmed) && /(\+|-)\d{2}:?\d{2}$| UTC| GMT/i.test(trimmed)) {
    return null;
  }
  if (/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/.test(trimmed)) {
    return null;
  }
  const monthName = new RegExp(`\\b(${Object.keys(MONTH_NAMES).join("|")})\\b`, "i").exec(trimmed);
  if (!monthName) {
    return null;
  }
  const month = MONTH_NAMES[monthName[1].toLowerCase()];
  const yearMatch = /\b((?:19|20)\d{2})\b/.exec(trimmed);
  const dayMatch = /\b(\d{1,2})\b/.exec(trimmed.replace(yearMatch?.[0] ?? "", ""));
  if (!yearMatch || !dayMatch) {
    return null;
  }
  const dayNum = Number.parseInt(dayMatch[1], 10);
  if (dayNum < 1 || dayNum > 31) {
    return null;
  }
  const day = `${yearMatch[1]}-${month}-${String(dayNum).padStart(2, "0")}`;
  return Number.isNaN(new Date(`${day}T00:00:00Z`).getTime()) ? null : day;
}

export interface Evaluation {
	scored: boolean;
	eligibility: GateResult<EligibilityVerdict>;
	languageGate: GateResult<LanguageVerdict>;
	dimensions: DimensionScore[];
	overallScore: number | null;
	verdict: Verdict | null;
	strengths: string[];
	gaps: string[];
	recommendation: string;
	shouldCallEmployer: EmployerCall;
	needsConfirmation: true;
	deadline: string | null;
	source: string;
	/** Full posting text retained for archiving. */
	archive: string;
}

/**
 * Full fit evaluation: gates first (a FAIL stops before scoring),
 * then weighted dimensions, verdict, strengths, gaps, and recommendation.
 */
export function evaluateJob(input: {
	postingText: string;
	profile: Profile;
	source?: string;
}): Evaluation {
	const source = input.source ?? "pasted-text";
	const eligibility = checkEligibility(input.postingText, input.profile);
	const languageGate = checkLanguage(input.postingText, input.profile);
	const base = {
		eligibility,
		languageGate,
		shouldCallEmployer: shouldCallEmployer(input.postingText),
		needsConfirmation: true as const,
		deadline: extractDeadline(input.postingText),
		source,
		archive: input.postingText,
	};

	if (eligibility.verdict === "FAIL" || languageGate.verdict === "FAIL") {
		const failed = eligibility.verdict === "FAIL" ? eligibility : languageGate;
		return {
			...base,
			scored: false,
			dimensions: [],
			overallScore: null,
			verdict: null,
			strengths: [],
			gaps: [],
			recommendation: `Do not apply: gate failed (${failed.quote ?? failed.note}).`,
		};
	}

	if (!profileHasScoringSignal(input.profile)) {
		return {
			...base,
			scored: false,
			dimensions: [],
			overallScore: null,
			verdict: null,
			strengths: [],
			gaps: [],
			recommendation: UNSET_PROFILE_RECOMMENDATION,
		};
	}

	const dimensions = scoreDimensions(input.postingText, input.profile);
	const overall = overallScore(dimensions);
	const verdict = verdictFor(overall);
	return {
		...base,
		scored: true,
		dimensions,
		overallScore: overall,
		verdict,
		strengths: extractStrengths(input.postingText, input.profile),
		gaps: extractGaps(input.postingText, input.profile),
		recommendation: finalizeRecommendation(recommendationFor(verdict), eligibility.verdict),
	};
}
