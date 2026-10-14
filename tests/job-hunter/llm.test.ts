import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildRefinePrompt, mergeRefinement } from "@/lib/job-hunter/llm.ts";
import { evaluateJob } from "@/lib/job-hunter/evaluate.ts";
import type { Profile } from "@/lib/job-hunter/profile.ts";
import { DEFAULT_PROFILE } from "@/lib/job-hunter/profile.ts";

const PROFILE: Profile = {
	...DEFAULT_PROFILE,
	name: "Test Candidate",
	preferences: { targetRoles: ["ML Engineer"] },
	skills: [{ name: "Python", category: "primary" as const }, { name: "SQL", category: "primary" as const }],
	domains: [{ name: "fraud detection", category: "strong" as const }],
	energizingTasks: ["model building"],
	drainingTasks: ["maintenance"],
	languages: [{ language: "English", level: "C1" }],
};

const POSTING = [
	"Senior ML Engineer at Acme.",
	"We welcome international applicants.",
	"Requirements: Python, SQL.",
	"Domain: fraud detection.",
].join("\n");

function baseEvaluation() {
	return evaluateJob({ postingText: POSTING, profile: PROFILE, source: "test" });
}

describe("buildRefinePrompt", () => {
	it("frames the posting as untrusted data and demands JSON", () => {
		const base = baseEvaluation();
		const prompt = buildRefinePrompt(POSTING, PROFILE, base);
		assert.match(prompt, /untrusted/i);
		assert.match(prompt, /ignore.*instructions/i);
		assert.match(prompt, /JSON/);
		assert.ok(prompt.includes(POSTING));
		assert.ok(prompt.includes("Test Candidate"));
		assert.ok(prompt.includes("heuristic"));
	});
});

describe("mergeRefinement", () => {
	it("applies refined scores and recomputes overall plus verdict deterministically", () => {
		const merged = mergeRefinement(baseEvaluation(), POSTING, PROFILE, {
			dimensions: [
				{ dimension: "technical", score: 90, reason: "all core skills present" },
				{ dimension: "experience", score: 88, reason: "direct domain match" },
				{ dimension: "behavioral", score: 60, reason: "compatible" },
				{ dimension: "career", score: 92, reason: "aligned" },
			],
		});
		const dims = Object.fromEntries(merged.dimensions.map((d) => [d.dimension, d]));
		assert.equal(dims["technical"].score, 90);
		assert.equal(dims["location"].score, null);
		assert.equal(merged.overallScore, 86);
		assert.equal(merged.verdict, "Strong Fit");
		assert.equal(merged.scored, true);
	});

	it("keeps the heuristic value for an out-of-range refined score", () => {
		const base = baseEvaluation();
		const before = base.dimensions.find((d) => d.dimension === "technical")?.score;
		const merged = mergeRefinement(base, POSTING, PROFILE, {
			dimensions: [{ dimension: "technical", score: 150, reason: "too high" }],
		});
		assert.equal(merged.dimensions.find((d) => d.dimension === "technical")?.score, before);
	});

	it("ignores a refinement that is not valid JSON-shaped", () => {
		const base = baseEvaluation();
		assert.deepEqual(mergeRefinement(base, POSTING, PROFILE, "not json"), base);
		assert.deepEqual(mergeRefinement(base, POSTING, PROFILE, { dimensions: "nope" }), base);
	});

	it("keeps a gate the LLM answers with an unknown verdict", () => {
		const base = baseEvaluation();
		const merged = mergeRefinement(base, POSTING, PROFILE, {
			eligibility: { verdict: "MAYBE", note: "unsure" },
		});
		assert.equal(merged.eligibility.verdict, base.eligibility.verdict);
		assert.equal(merged.scored, true);
	});

	it("flips to unscored when the LLM fails a gate", () => {
		const merged = mergeRefinement(baseEvaluation(), POSTING, PROFILE, {
			eligibility: { verdict: "FAIL", quote: "citizens only", note: "hard requirement" },
		});
		assert.equal(merged.scored, false);
		assert.equal(merged.overallScore, null);
		assert.equal(merged.verdict, null);
		assert.match(merged.recommendation, /do not apply/i);
	});

	it("applies refined strengths, gaps, recommendation, and employer-call", () => {
		const merged = mergeRefinement(baseEvaluation(), POSTING, PROFILE, {
			strengths: ["deep fraud background"],
			gaps: ["no leadership experience"],
			recommendation: "Apply with a leadership story.",
			shouldCallEmployer: { suggest: true, reason: "ask about team size" },
		});
		assert.deepEqual(merged.strengths, ["deep fraud background"]);
		assert.deepEqual(merged.gaps, ["no leadership experience"]);
		assert.equal(merged.recommendation, "Apply with a leadership story.");
		assert.equal(merged.shouldCallEmployer.suggest, true);
	});

	it("keeps an unscored base unscored when the profile carries no signal", () => {
		const base = evaluateJob({ postingText: POSTING, profile: DEFAULT_PROFILE, source: "test" });
		assert.equal(base.scored, false);
		const merged = mergeRefinement(base, POSTING, DEFAULT_PROFILE, {
			dimensions: [{ dimension: "technical", score: 95, reason: "looks strong" }],
			strengths: ["everything"],
			gaps: [],
			recommendation: "Apply immediately.",
		});
		assert.equal(merged.scored, false);
		assert.equal(merged.overallScore, null);
		assert.equal(merged.verdict, null);
		assert.deepEqual(merged.dimensions, []);
	});

	it("rescores from scratch when the LLM overturns a gate FAIL", () => {
		const failed = evaluateJob({
			postingText: "Applicants must be citizens of Denmark. Python role.",
			profile: PROFILE,
		});
		assert.equal(failed.scored, false);
		const merged = mergeRefinement(
			failed,
			"Applicants must be citizens of Denmark. Python role.",
			PROFILE,
			{ eligibility: { verdict: "PASS", note: "sponsor confirmed" } },
		);
		assert.equal(merged.scored, true);
		assert.ok(merged.overallScore !== null);
		assert.ok(merged.verdict !== null);
	});

	it("leaves deadline, source, archive, and confirmation untouched", () => {
		const merged = mergeRefinement(baseEvaluation(), POSTING, PROFILE, {
			dimensions: [{ dimension: "technical", score: 10, reason: "harsh" }],
		});
		assert.equal(merged.source, "test");
		assert.equal(merged.archive, POSTING);
		assert.equal(merged.needsConfirmation, true);
		assert.equal(merged.deadline, baseEvaluation().deadline);
	});
});
