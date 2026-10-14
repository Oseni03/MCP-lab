import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { checkLanguage, parsePostingDay, phraseMatches, SKILL_ALIASES } from "@/lib/job-hunter/evaluate.ts";
import { DEFAULT_PROFILE } from "@/lib/job-hunter/profile.ts";

// Issue 12 slice A: word-boundary matching + short-token guard + alias map.
describe("phraseMatches (issue 12)", () => {
	it("matches whole words case-insensitively", () => {
		assert.equal(phraseMatches("We need Python and SQL.", "Python"), true);
		assert.equal(phraseMatches("We need Python and SQL.", "sql"), true);
		assert.equal(phraseMatches("We need Python and SQL.", "Java"), false);
	});

	it("does not match substrings inside longer words", () => {
		assert.equal(phraseMatches("Looking for a Good team player.", "Go"), false);
		assert.equal(phraseMatches("Django experience required.", "Go"), false);
		assert.equal(phraseMatches("We set Goals quarterly.", "Go"), false);
		assert.equal(phraseMatches("Go developer wanted.", "Go"), true);
	});

	it("guards single-letter skills: R matches the token, not React/Docker", () => {
		assert.equal(phraseMatches("R programming for stats.", "R"), true);
		assert.equal(phraseMatches("React developer wanted.", "R"), false);
		assert.equal(phraseMatches("Docker experience required.", "R"), false);
	});

	it("resolves aliases bidirectionally for true synonyms", () => {
		assert.ok((SKILL_ALIASES["k8s"] ?? []).includes("kubernetes"));
		assert.equal(phraseMatches("Kubernetes experience required.", "K8s"), true);
		assert.equal(phraseMatches("K8s cluster ops.", "Kubernetes"), true);
		assert.equal(phraseMatches("JavaScript required.", "JS"), true);
		assert.equal(phraseMatches("PostgreSQL tuning.", "Postgres"), true);
	});

	it("does not let generic SQL claim specific Postgres via alias", () => {
		// "PostgreSQL" must not satisfy a bare "SQL" profile phrase through
		// substring overlap; SQL is broader and stays a separate skill.
		assert.equal(phraseMatches("PostgreSQL tuning.", "SQL"), false);
		assert.equal(phraseMatches("SQL queries and joins.", "SQL"), true);
	});

	it("matches multi-word phrases on word boundaries", () => {
		assert.equal(phraseMatches("Machine Learning for fraud detection.", "Machine Learning"), true);
		assert.equal(phraseMatches("We love machine-learning pipelines.", "Machine Learning"), false);
	});
});

const LANG_PROFILE = {
	...DEFAULT_PROFILE,
	name: "Test Candidate",
	languages: [{ language: "English", level: "C1" }],
	// Scoring signal so these tests exercise thin probe text, not an empty
	// profile (which withholds the band on its own).
	skills: [{ name: "Python", category: "primary" as const }, { name: "SQL", category: "primary" as const }],
	domains: [{ name: "fraud detection", category: "strong" as const }],
	preferences: { targetRoles: ["ML Engineer"] },
	energizingTasks: ["model building"],
	drainingTasks: [],
};

// Issue 12 slice C: negative-context guard rides the matching work.
describe("checkLanguage negative context (issue 12)", () => {
	it("ignores company-history mentions of language-named nationalities", () => {
		// "must" trips the requirement context; "founded" must suppress the
		// Danish hit anyway. Without the guard this FAILs.
		const result = checkLanguage(
			"Founded by Danish engineers in 2010; you must know our stack.\nPython required for the role.",
			LANG_PROFILE,
		);
		assert.equal(result.verdict, "PASS");
	});

	it("does not gate on headquarters-location lines even with requirement words", () => {
		const result = checkLanguage(
			"You must work at our Danish headquarters in Copenhagen.\nPython required.",
			LANG_PROFILE,
		);
		assert.equal(result.verdict, "PASS");
	});

	it("still FAILs a genuine undeclared requirement", () => {
		const result = checkLanguage("Fluent Danish required for client calls.", LANG_PROFILE);
		assert.equal(result.verdict, "FAIL");
	});
});

// Issue 12 slice E: thin-evidence confidence and stable sorting.
describe("thin evidence and sorting (issue 12)", () => {
	function candidate(overrides: Record<string, unknown> = {}) {
		return {
			title: "ML Engineer",
			company: "Acme",
			url: "https://example.com/jobs/1",
			description: "Python and SQL for fraud detection.",
			postedDate: "2026-09-20",
			...overrides,
		};
	}

	it("withholds the band on thin probe text instead of asserting low", async () => {
		const { planSearch } = await import("@/lib/job-hunter/search.ts");
		const plan = await planSearch({
			profile: LANG_PROFILE,
			scraperAdapters: ["test"],
			scraperFetch: async () => [candidate({ description: "" })],
			filters: { keywords: "ML Engineer" },
			now: new Date("2026-09-29T00:00:00Z"),
		});
		assert.equal(plan.candidates.length, 1);
		const fit = plan.candidates[0].quickFit;
		assert.equal(fit.lowEvidence, true);
		assert.equal(fit.band, "unscored");
		assert.equal(fit.textLength, plan.candidates[0].quickFit.textLength);
		assert.deepEqual(plan.candidates[0].referralLinks, []);
	});

	it("keeps the language-FAIL low override on thin text (gate, not confidence)", async () => {
		const { planSearch } = await import("@/lib/job-hunter/search.ts");
		const plan = await planSearch({
			profile: LANG_PROFILE,
			scraperAdapters: ["test"],
			scraperFetch: async () => [candidate({ description: "Fluent Danish required." })],
			filters: { keywords: "ML Engineer" },
			now: new Date("2026-09-29T00:00:00Z"),
		});
		assert.equal(plan.candidates[0].quickFit.band, "low");
		assert.equal(plan.candidates[0].quickFit.lowEvidence, true);
		assert.equal(plan.candidates[0].language.verdict, "FAIL");
	});

	it("sorts by score descending so the limit keeps the best matches", async () => {
		const { planSearch } = await import("@/lib/job-hunter/search.ts");
		const rich = (skill: string) =>
			`${skill} developer with many years of shipped production experience, mentoring, on-call rotations, and cross-team design reviews across several organizations.`;
		const plan = await planSearch({
			profile: {
				...LANG_PROFILE,
				preferences: { targetRoles: ["ML Engineer"] },
				skills: [{ name: "Python", category: "primary" as const }, { name: "SQL", category: "primary" as const }],
				domains: [{ name: "fraud detection", category: "strong" as const }],
				energizingTasks: [],
				drainingTasks: [],
			},
			scraperAdapters: ["test"],
			scraperFetch: async () => [
				candidate({
					title: "Junior Clerk",
					url: "https://example.com/jobs/low",
					description: rich("filing and paperwork"),
				}),
				candidate({
					title: "ML Engineer",
					url: "https://example.com/jobs/high",
					description: `Python and SQL for fraud detection. ${rich("ML Engineer")}`,
				}),
			],
			filters: { limit: 1 },
			now: new Date("2026-09-29T00:00:00Z"),
		});
		assert.equal(plan.candidates.length, 1);
		assert.equal(plan.candidates[0].url, "https://example.com/jobs/high");
	});
});

// Issue 12 slice D: relative dates resolve against the injected now.
describe("parsePostingDay (issue 12)", () => {
	const NOW = new Date("2026-09-29T12:00:00Z");

	it("keeps YYYY-MM-DD priority", () => {
		assert.equal(parsePostingDay("2026-09-20", NOW), "2026-09-20");
		assert.equal(parsePostingDay("2026-09-20T10:00:00Z", NOW), "2026-09-20");
	});

	it("resolves day-exact relative phrases", () => {
		assert.equal(parsePostingDay("3 days ago", NOW), "2026-09-26");
		assert.equal(parsePostingDay("Yesterday", NOW), "2026-09-28");
		assert.equal(parsePostingDay("last week", NOW), "2026-09-22");
		assert.equal(parsePostingDay("2 weeks ago", NOW), "2026-09-15");
	});

	it("stays unknown on unparseable input, never guessed", () => {
		assert.equal(parsePostingDay(undefined, NOW), null);
		assert.equal(parsePostingDay("", NOW), null);
		assert.equal(parsePostingDay("sometime soon", NOW), null);
		assert.equal(parsePostingDay("last month", NOW), null);
	});
});
