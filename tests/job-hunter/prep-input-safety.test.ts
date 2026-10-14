import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { planInterviewPrep } from "@/lib/job-hunter/prep.ts";
import { stripHtmlToProse } from "@/lib/job-hunter/verify.ts";

const PROFILE = {
	name: "Test Candidate",
	preferences: { targetRoles: ["ML Engineer"] },
	skills: [{ name: "Python", category: "primary" as const }, { name: "SQL", category: "primary" as const }, { name: "Docker", category: "secondary" as const }],
	domains: [{ name: "fraud detection", category: "strong" as const }],
	energizingTasks: ["model building"],
	languages: [{ language: "English", level: "C1" }],
};

const POSTING = [
	"Senior ML Engineer at Acme.",
	"Requirements: Python, Kubernetes.",
	"Domain: fraud detection.",
].join("\n");

const BASE = {
	company: "Acme",
	role: "Senior ML Engineer",
	stage: "technical",
	postingText: POSTING,
	profile: PROFILE,
};

describe("prep empty-slug hard error", () => {
	it("refuses with no pack path when nothing identifies the interview", () => {
		const plan = planInterviewPrep({ company: "   ", role: "  ", profile: PROFILE });
		assert.equal(plan.slug, "");
		assert.equal(plan.packFile, "");
		assert.deepEqual(plan.questions, []);
		assert.deepEqual(plan.newStarDrafts, []);
		assert.ok(plan.warnings.some((warning) => warning.includes("EMPTY_SLUG")), "expected the EMPTY_SLUG hard error");
		assert.ok(plan.packMarkdown.includes("EMPTY_SLUG"), "refusal is the pack content");
		assert.ok(plan.fallbackNotes.some((note) => note.includes("EMPTY_SLUG")));
	});
});

describe("prep HTML-aware probeable claims", () => {
	const HTML_CV = [
		"<h2>Senior ML Engineer at Acme, Berlin (2020-2024)</h2>",
		"<p>Built Python pipelines cutting fraud losses by 12%.</p>",
		"<h2>Skills</h2>",
	].join("\n");

	it("strips markup before line-splitting", () => {
		const prose = stripHtmlToProse(HTML_CV);
		assert.ok(!prose.includes("<") && !prose.includes(">"), "tags stripped");
		assert.ok(prose.includes("12"), "digits survive for the quantified pass");
	});

	it("emits no markup-bearing claims from a generated CV", () => {
		const plan = planInterviewPrep({ ...BASE, cvText: HTML_CV });
		assert.ok(plan.probeableClaims.length > 0, "expected the quantified claim to surface");
		for (const claim of plan.probeableClaims) {
			assert.ok(!claim.includes("<") && !claim.includes(">"), `markup leaked into claim: ${claim}`);
		}
		assert.ok(
			plan.probeableClaims.some((claim) => claim.includes("12")),
			"expected the quantified achievement to be probeable",
		);
	});
});

describe("prep STAR coverage without filler", () => {
	it("leaves genuinely uncovered questions uncovered under filler-heavy tags", () => {
		const plan = planInterviewPrep({
			...BASE,
			starExamples: [
				{
					title: "Filler-tagged example",
					situation: "Work happened.",
					task: "Tasks were done.",
					action: "Acted accordingly.",
					result: "Results followed.",
					useFor: ["experience and the team for our role"],
				},
			],
		});
		const mapping = plan.starMapping.find((entry) => entry.title === "Filler-tagged example");
		assert.ok(mapping, "expected the example to be mapped");
		assert.deepEqual(mapping.covers, [], "filler words must not count as coverage");
		assert.ok(
			plan.uncoveredQuestions.includes("Walk through your experience with Python."),
			"expected the Python question to surface as uncovered",
		);
	});

	it("still covers questions on genuine tag words", () => {
		const plan = planInterviewPrep({
			...BASE,
			starExamples: [
				{
					title: "Python example",
					situation: "Work happened.",
					task: "Tasks were done.",
					action: "Built a Python pipeline.",
					result: "It shipped.",
					useFor: ["Python"],
				},
			],
		});
		const mapping = plan.starMapping.find((entry) => entry.title === "Python example");
		assert.ok(mapping, "expected the example to be mapped");
		assert.ok(
			mapping.covers.includes("Walk through your experience with Python."),
			"expected genuine tag coverage to survive the stopword screen",
		);
	});
});

describe("prep stage aliases", () => {
	it("resolves ordinary stage names onto the five banks with a note", () => {
		const cases = [
			["phone screen", "recruiter-screen"],
			["HR round", "recruiter-screen"],
			["system design", "technical"],
			["final round", "panel-onsite"],
			["hiring manager", "hiring-manager"],
		] as const;
		for (const [raw, stage] of cases) {
			const plan = planInterviewPrep({ ...BASE, stage: raw });
			assert.equal(plan.stage, stage, `stage '${raw}'`);
			assert.ok(
				plan.fallbackNotes.some((note) => note.includes(`'${raw}' read as '${stage}'`)),
				`expected the alias resolution to be noted for '${raw}'`,
			);
			assert.ok(plan.packFile.endsWith(`/${stage}-prep.md`), "pack path follows the resolved bank");
		}
	});

	it("keeps exact bank names note-free", () => {
		const plan = planInterviewPrep(BASE);
		assert.equal(plan.stage, "technical");
		assert.ok(
			plan.fallbackNotes.every((note) => !note.includes("read as")),
			"exact bank names resolve silently",
		);
	});

	it("names every matched bank on ambiguity and reads the first", () => {
		const plan = planInterviewPrep({ ...BASE, stage: "final hiring manager round" });
		assert.equal(plan.stage, "hiring-manager");
		const note = plan.fallbackNotes.find((entry) => entry.includes("several banks"));
		assert.ok(note, "expected an ambiguity note");
		assert.ok(note.includes("hiring-manager") && note.includes("panel-onsite"), "note names every matched bank");
	});

	it("stays generic with a note on truly unknown stages", () => {
		const plan = planInterviewPrep({ ...BASE, stage: "stargazing sync" });
		assert.equal(plan.stage, "other");
		assert.ok(plan.fallbackNotes.some((note) => note.includes("stay generic")));
	});
});

describe("prep pack-path safety", () => {
	it("keeps posting-derived path segments to slug characters only", () => {
		const plan = planInterviewPrep({ ...BASE, company: "../evil" });
		assert.ok(/^[a-z0-9][a-z0-9-]*_[a-z0-9][a-z0-9-]*$/.test(plan.slug), `unsafe slug: ${plan.slug}`);
		assert.ok(!plan.slug.includes(".") && !plan.slug.includes("/"));
		assert.equal(plan.packFile, `documents/applications/${plan.slug}/technical-prep.md`);
		assert.ok(!plan.packFile.includes(".."));
	});
});
