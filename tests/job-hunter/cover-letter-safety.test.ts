import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
	buildCoverLetter,
	extractWorkMode,
	normalizeCompanySpecifics,
	pickBridgeAnchor,
	wordOverlap,
} from "@/lib/job-hunter/tailor.ts";
import { planPortalFields } from "@/lib/job-hunter/fields.ts";

const PROFILE = {
	name: "Test Candidate",
	location: "Copenhagen, Denmark",
	workCountry: "Denmark",
	permitClasses: [],
	languages: [{ language: "English", level: "C1" }],
	preferences: { targetRoles: ["ML Engineer"] },
	skills: [{ name: "Python", category: "primary" as const }, { name: "SQL", category: "primary" as const }, { name: "Machine Learning", category: "primary" as const }, { name: "Docker", category: "secondary" as const }, { name: "Fraud Analytics", category: "secondary" as const }],
	domains: [{ name: "fraud detection", category: "strong" as const }, { name: "credit risk", category: "adjacent" as const }],
	energizingTasks: ["model building"],
	drainingTasks: ["maintenance"],
} as never;

const PASS_SUMMARY = {
	verdict: "Good Fit",
	eligibility: { verdict: "PASS" },
	languageGate: { verdict: "PASS" },
};

describe("wordOverlap bridge machinery", () => {
	it("scores shared content words and nothing else", () => {
		assert.ok(wordOverlap("fraud investigation models", "fraud detection") > 0);
		assert.equal(wordOverlap("Kubernetes", "Docker"), 0);
	});

	it("picks the anchor by overlap and names none when unrelated", () => {
		assert.equal(
			pickBridgeAnchor("fraud investigation models", ["Docker", "Fraud Analytics"]),
			"Fraud Analytics",
		);
		assert.equal(pickBridgeAnchor("Kubernetes", ["Docker", "credit risk"]), null);
	});
});

describe("letter logistics honesty", () => {
	it("leaves the deadline out of employer-facing text and keeps the reference", () => {
		const posting = [
			"Senior ML Engineer at Acme.",
			"Requirements: Python.",
			"Remote. Apply by 15 March 2026. Ref: ACME-123.",
		].join("\n");
		const result = buildCoverLetter({
			postingText: posting,
			company: "Acme",
			role: "Senior ML Engineer",
			profile: PROFILE,
			evaluation: PASS_SUMMARY,
		});
		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.ok(!result.html.includes("15 March 2026"), "no deadline printed to the employer");
		assert.ok(!result.html.includes("2026-03-15"), "no ISO deadline either");
		assert.ok(result.html.includes("ACME-123"), "reference ID kept");
	});

	it("reports Onsite for mixed remote-culture plus onsite-commitment text", () => {
		assert.equal(
			extractWorkMode("We have a remote-first culture, with onsite twice a week in Copenhagen."),
			"Onsite",
		);
	});

	it("still reports plain Remote, Hybrid, and nothing for lone culture praise", () => {
		assert.equal(extractWorkMode("This is a fully Remote position."), "Remote");
		assert.equal(extractWorkMode("Hybrid work available."), "Hybrid");
		assert.equal(extractWorkMode("We have a remote-first culture and value balance."), null);
	});

	it("carries the mixed-case verdict into the letter logistics line", () => {
		const posting = [
			"ML Engineer at Acme.",
			"Requirements: Python.",
			"We have a remote-first culture, with onsite twice a week in Copenhagen. Ref: ACME-9.",
		].join("\n");
		const result = buildCoverLetter({
			postingText: posting,
			company: "Acme",
			role: "ML Engineer",
			profile: PROFILE,
			evaluation: PASS_SUMMARY,
		});
		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.equal(result.logistics.workMode, "Onsite");
		assert.ok(result.html.includes("Onsite arrangement"), "letter states the onsite arrangement");
	});
});

describe("bridges stop making promises", () => {
	it("anchors the gap bridge by overlap and flags the one-month plan as a commitment", () => {
		const posting = ["ML Engineer at Acme.", "Requirements: Python, model validation."].join("\n");
		const result = buildCoverLetter({
			postingText: posting,
			company: "Acme",
			role: "ML Engineer",
			profile: {
				...(PROFILE as unknown as Record<string, unknown>),
				skills: [
					{ name: "Docker", category: "secondary" },
					{ name: "Fraud Models", category: "secondary" },
				],
			} as never,
			evaluation: PASS_SUMMARY,
		});
		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.ok(
			result.html.includes("Fraud Models"),
			"bridge anchors on the overlapping skill, not the first secondary",
		);
		assert.ok(
			!result.html.includes("I bring Docker experience"),
			"the unrelated first secondary is not named",
		);
		const stretch = result.warnings.stretchChoices[0];
		assert.ok(stretch, "gap stays behind the keep/soften/drop question");
		assert.ok(
			stretch.reason.includes("commitment") && stretch.reason.includes("cannot confirm"),
			"the reason carries what the stateless tool cannot check",
		);
	});

	it("names no anchor when nothing overlaps instead of an unrelated skill", () => {
		const posting = ["ML Engineer at Acme.", "Requirements: Python, Kubernetes."].join("\n");
		const result = buildCoverLetter({
			postingText: posting,
			company: "Acme",
			role: "ML Engineer",
			profile: PROFILE,
			evaluation: PASS_SUMMARY,
		});
		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.ok(!result.html.includes("I bring Docker experience"), "unrelated anchor not named");
		assert.ok(result.html.includes("related work"), "honest fallback without a false claim");
	});
});

describe("companySpecifics provenance", () => {
	it("refuses URL-less entries and plugs research claims straight in", () => {
		const result = buildCoverLetter({
			postingText: "ML Engineer at Acme.\nRequirements: Python.",
			company: "Acme",
			role: "ML Engineer",
			profile: PROFILE,
			companySpecifics: [
				"Acme is great, trust me.",
				{ text: "Acme processes payments across Europe.", sourceUrl: "https://acme.example/about" },
				{ text: "No URL here.", sourceUrl: "" },
			],
			evaluation: PASS_SUMMARY,
		});
		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.ok(!result.html.includes("Acme is great"), "URL-less string refused");
		assert.ok(!result.html.includes("No URL here"), "URL-less object refused");
		assert.ok(result.html.includes("https://acme.example/about"), "sourced claim kept with its URL");
		assert.ok(
			result.warnings.provenanceNote?.includes("Refused 2"),
			`refusal counted, got ${result.warnings.provenanceNote}`,
		);
	});

	it("normalizes research claims and counts refusals", () => {
		const normalized = normalizeCompanySpecifics([
			{ text: "Acme ships weekly.", sourceUrl: "https://acme.example/blog" },
			"bare string",
		]);
		assert.equal(normalized.kept.length, 1);
		assert.equal(normalized.dropped, 1);
	});

	it("reads naturally against realistic fetched sentences", () => {
		const fetched = [
			{
				text: "Acme Corp launched a fraud detection product in 2025.",
				sourceUrl: "https://media.example/acme-launch",
			},
			{
				text: "Employees rate Acme Corp 4.1 for work life balance.",
				sourceUrl: "https://reviews.example/acme",
			},
		];
		const result = buildCoverLetter({
			postingText: "ML Engineer at Acme.\nRequirements: Python.",
			company: "Acme",
			role: "ML Engineer",
			profile: PROFILE,
			companySpecifics: fetched,
			evaluation: PASS_SUMMARY,
		});
		assert.equal(result.ok, true);
		if (!result.ok) return;
		for (const claim of fetched) {
			const quoted = claim.text.trim().replace(/[.]+$/, "");
			assert.ok(
				result.html.includes(`&quot;${quoted}&quot; (${claim.sourceUrl})`),
				"quote-and-link phrasing cites each fetched sentence (HTML-escaped)",
			);
		}
	});

	it("refuses URL-less employer points in draft-application-answers the same way", () => {
		const plan = planPortalFields({
			profile: PROFILE,
			company: "Acme",
			employerPoints: [
				"Acme is great.",
				{ text: "Acme processes payments across Europe.", sourceUrl: "https://acme.example/about" },
			],
		});
		assert.ok(
			plan.warnings.some((warning) => warning.includes("Refused 1 employer point")),
			"draft-application-answers refusal counted",
		);
		assert.ok(
			plan.selfIntros.every((intro) => !intro.text.includes("Acme is great")),
			"URL-less point never ties the intro",
		);
	});
});

describe("bullet escape round trip", () => {
	it("emits labels and bodies after exactly one escape pass", () => {
		const profile = {
			...(PROFILE as Record<string, unknown>),
	skills: [{ name: "C++", category: "primary" as const }, { name: "R&D", category: "primary" as const }, { name: "A}B", category: "primary" as const }],
		} as never;
		const posting = ["ML Engineer at Acme.", "Requirements: C++, R&D, A}B."].join("\n");
		const result = buildCoverLetter({
			postingText: posting,
			company: "Acme",
			role: "ML Engineer",
			profile,
			evaluation: PASS_SUMMARY,
		});
		assert.equal(result.ok, true);
		if (!result.ok) return;
		assert.ok(result.html.includes("<strong>R&amp;D</strong>"), "ampersand escaped in HTML");
		assert.ok(result.html.includes("<strong>A}B</strong>"), "brace remains text in HTML");
	});
});
