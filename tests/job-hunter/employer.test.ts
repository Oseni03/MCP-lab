import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
	evaluateJob,
	extractDeadline,
	extractGaps,
	extractStrengths,
	recommendationFor,
	shouldCallEmployer,
} from "@/lib/job-hunter/evaluate.ts";
import type { Profile } from "@/lib/job-hunter/profile.ts";
import { DEFAULT_PROFILE } from "@/lib/job-hunter/profile.ts";

const PROFILE: Profile = {
	...DEFAULT_PROFILE,
	name: "Test Candidate",
	preferences: { targetRoles: ["ML Engineer"] },
	skills: [{ name: "Python", category: "primary" as const }, { name: "SQL", category: "primary" as const }, { name: "Docker", category: "secondary" as const }],
	domains: [{ name: "fraud detection", category: "strong" as const }],
	energizingTasks: ["model building"],
	drainingTasks: ["maintenance"],
};

const POSTING = [
	"Senior ML Engineer at Acme.",
	"Requirements: Python, SQL, Kubernetes.",
	"Domain: fraud detection.",
	"Apply by 15 March 2026.",
].join("\n");

describe("extractStrengths and extractGaps", () => {
	it("lists matched skills and domains as strengths", () => {
		const strengths = extractStrengths(POSTING, PROFILE);
		assert.ok(strengths.some((s) => s.includes("Python")));
		assert.ok(strengths.some((s) => s.includes("fraud detection")));
	});

	it("lists posting requirements missing from the profile as gaps", () => {
		const gaps = extractGaps(POSTING, PROFILE);
		assert.ok(gaps.some((g) => g.toLowerCase().includes("kubernetes")));
		assert.ok(!gaps.some((g) => g.toLowerCase().includes("python")));
	});
});

describe("recommendationFor", () => {
	it("tells Strong fits to apply and Poor fits to skip", () => {
		assert.match(recommendationFor("Strong Fit"), /apply/i);
		assert.match(recommendationFor("Poor Fit"), /skip/i);
	});

	it("tells Good fits to address gaps in the cover letter", () => {
		assert.match(recommendationFor("Good Fit"), /cover letter/i);
	});
});

describe("shouldCallEmployer", () => {
	it("suggests calling when a named contact invites questions", () => {
		const result = shouldCallEmployer(
			"Questions? Contact Jane Doe at jane@acme.com, happy to help.",
		);
		assert.equal(result.suggest, true);
		assert.match(result.reason, /contact/i);
	});

	it("suggests calling when the description is vague", () => {
		const result = shouldCallEmployer("Various tasks to be defined. Details TBD.");
		assert.equal(result.suggest, true);
	});

	it("does not suggest calling for a specific posting", () => {
		const result = shouldCallEmployer(
			"Requirements: Python 5+ years. Essential: SQL. Desirable: Docker. Day to day: build fraud models.",
		);
		assert.equal(result.suggest, false);
	});
});

describe("extractDeadline", () => {
	it("extracts a deadline date", () => {
		assert.equal(extractDeadline(POSTING), "15 March 2026");
	});

	it("returns null when no deadline is stated", () => {
		assert.equal(extractDeadline("Great role. Apply today."), null);
	});
});

describe("evaluateJob", () => {
	it("returns a full evaluation for a passing posting", () => {
		const result = evaluateJob({ postingText: POSTING, profile: PROFILE, source: "test" });
		assert.equal(result.scored, true);
		assert.ok(result.overallScore !== null && result.overallScore >= 0);
		assert.ok(result.verdict !== null);
		assert.ok(result.strengths.length > 0);
		assert.ok(result.gaps.length > 0);
		assert.equal(result.needsConfirmation, true);
		assert.equal(result.deadline, "15 March 2026");
		assert.equal(result.source, "test");
		assert.equal(result.archive, POSTING);
	});

	it("stops before scoring on an eligibility FAIL", () => {
		const result = evaluateJob({
			postingText: "Applicants must be citizens of Denmark. Python role.",
			profile: PROFILE,
		});
		assert.equal(result.scored, false);
		assert.equal(result.eligibility.verdict, "FAIL");
		assert.equal(result.overallScore, null);
		assert.equal(result.needsConfirmation, true);
	});

	it("stops before scoring on a language FAIL", () => {
		const result = evaluateJob({
			postingText: "Fluent Russian required. Python role.",
			profile: PROFILE,
		});
		assert.equal(result.scored, false);
		assert.equal(result.languageGate.verdict, "FAIL");
	});

	it("scores through a language FLAG", () => {
		const result = evaluateJob({
			postingText: "We require fluent English. Python role.",
			profile: { ...PROFILE, languages: [{ language: "English", level: "B1" }] },
		});
		assert.equal(result.scored, true);
		assert.equal(result.languageGate.verdict, "FLAG");
	});

	it("withholds the score when the profile carries no signal instead of inventing 50s", () => {
		for (const postingText of [
			"Senior ML Engineer at Acme. Requirements: Python, SQL. Domain: fraud detection.",
			"Junior Baker at Flour Co. Requirements: sourdough, early mornings.",
		]) {
			const result = evaluateJob({ postingText, profile: DEFAULT_PROFILE });
			assert.equal(result.scored, false);
			assert.equal(result.overallScore, null);
			assert.equal(result.verdict, null);
			assert.deepEqual(result.dimensions, []);
			assert.deepEqual(result.strengths, []);
			assert.deepEqual(result.gaps, []);
			assert.match(result.recommendation, /not set up yet/i);
		}
	});
});
