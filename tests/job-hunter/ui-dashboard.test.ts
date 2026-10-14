import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { SAMPLE_CALLS, SAMPLE_TOOLS } from "@/mcp-app/samples.ts";
import { TOOL_LABELS, TOOL_NAMES, TOOL_VIEWS, mapToolToDashboard } from "@/mcp-app/toolviews.ts";
import { TailorCvInput } from "@/lib/job-hunter/schemas/tailor-resume.ts";
import { CoverInput } from "@/lib/job-hunter/schemas/generate-cover-letter.ts";
import type { DashboardView } from "@/mcp-app/types.ts";

const EXPECTED_VIEWS: Record<(typeof SAMPLE_TOOLS)[number], DashboardView> = {
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

describe("dashboard mappers", () => {
	it("covers every registered tool with a labeled, non-empty view", () => {
		assert.deepEqual([...SAMPLE_TOOLS].sort(), Object.keys(EXPECTED_VIEWS).sort());
		assert.equal(
			new Set(Object.values(EXPECTED_VIEWS)).size,
			SAMPLE_TOOLS.length,
			"every tool renders its own view, never a shared generic one",
		);
		for (const tool of SAMPLE_TOOLS) {
			assert.ok(TOOL_LABELS[tool], `${tool} needs a human label for the picker`);
			const sample = SAMPLE_CALLS[tool];
			const data = mapToolToDashboard(tool, sample.args, sample.structured, sample.text);
			assert.equal(data.view, EXPECTED_VIEWS[tool], `${tool} maps to the wrong view`);
			assert.ok((data.title ?? "").length > 0, `${tool} renders without a title`);
			assert.ok(
				data.summary || (data.items?.length ?? 0) > 0 || data.markdown,
				`${tool} renders nothing`,
			);
		}
	});

	it("renders rich items for the high-signal tools", () => {
		const analysis = mapToolToDashboard(
			"analyze-job",
			SAMPLE_CALLS["analyze-job"].args,
			SAMPLE_CALLS["analyze-job"].structured,
			null,
		);
		assert.equal(analysis.items?.length, 4);
		assert.ok(analysis.summary?.includes("Strong Fit"));
		assert.ok(analysis.description?.includes("Build and own Python APIs"));

		const truncated = mapToolToDashboard("analyze-job", { postingText: `${"x".repeat(5000)}` }, {}, null);
		assert.ok((truncated.description?.length ?? 0) < 5000);
		assert.ok(truncated.description?.includes("truncated"));

		const profile = mapToolToDashboard(
			"setup-profile",
			{},
			{
				profile: {
					name: "Ada Example",
					projects: [{ name: "Risk engine", description: "Built a streaming fraud scoring service." }],
				},
			},
			null,
		);
		assert.equal(profile.items?.[0].title, "Risk engine");
		assert.equal(profile.items?.[0].note, "Built a streaming fraud scoring service.");

		const profileWithExperience = mapToolToDashboard(
			"setup-profile",
			{},
			{
				profile: {
					name: "Ada Example",
					experience: [
						{
							position: "ML Engineer",
							company: "Acme",
							description: "Built fraud detection models for card payments.",
						},
					],
				},
			},
			null,
		);
		assert.equal(profileWithExperience.items?.[0].title, "ML Engineer at Acme");
		assert.equal(profileWithExperience.items?.[0].note, "Built fraud detection models for card payments.");

		const linked = mapToolToDashboard(
			"analyze-job",
			{ postingUrl: "https://example.com/jobs/1" },
			{},
			null,
		);
		assert.equal(linked.description, "Full posting: https://example.com/jobs/1");

		assert.equal((analysis.details as { overallScore?: number }).overallScore, 82);
		assert.equal((analysis.details as { verdict?: string }).verdict, "Strong Fit");

		const analysisWithText = mapToolToDashboard(
			"analyze-job",
			SAMPLE_CALLS["analyze-job"].args,
			SAMPLE_CALLS["analyze-job"].structured,
			SAMPLE_CALLS["analyze-job"].text,
		);
		assert.ok(analysisWithText.markdown?.includes("## Job Fit Evaluation"));

		const rank = mapToolToDashboard("rank-jobs", {}, SAMPLE_CALLS["rank-jobs"].structured, null);
		assert.equal(rank.items?.length, 1);
		assert.equal(rank.items?.[0].score, 82);

		const followups = mapToolToDashboard(
			"due-followups",
			{},
			SAMPLE_CALLS["due-followups"].structured,
			null,
		);
		assert.equal(followups.items?.length, 1);
		assert.ok(followups.items?.[0].note?.includes("Send a short check-in."));
	});

	it("routes every tool to its own view, never a shared generic one", () => {
		assert.deepEqual(Object.keys(TOOL_VIEWS).sort(), [...SAMPLE_TOOLS].sort());
		for (const tool of SAMPLE_TOOLS) {
			assert.ok(TOOL_VIEWS[tool], `${tool} needs its own view`);
		}
	});

	it("targets next steps at MCP tools with prefilled args, never prose or external actions", () => {
		for (const tool of SAMPLE_TOOLS) {
			const sample = SAMPLE_CALLS[tool];
			const data = mapToolToDashboard(tool, sample.args, sample.structured, sample.text);
			for (const action of data.actions ?? []) {
				assert.ok(action.label.length > 0, `${tool} action needs a label`);
				assert.ok(
					(TOOL_NAMES as readonly string[]).includes(action.tool),
					`${tool} action targets unknown tool ${action.tool}`,
				);
			}
			for (const item of data.items ?? []) {
				if (!item.action) continue;
				assert.ok(item.action.label.length > 0, `${tool} item action needs a label`);
				assert.ok(
					(TOOL_NAMES as readonly string[]).includes(item.action.tool),
					`${tool} item action targets unknown tool ${item.action.tool}`,
				);
			}
		}

		const analysis = mapToolToDashboard(
			"analyze-job",
			SAMPLE_CALLS["analyze-job"].args,
			SAMPLE_CALLS["analyze-job"].structured,
			null,
		);
		const tailor = (analysis.actions ?? []).find((action) => action.tool === "tailor-resume");
		assert.ok(tailor, "analyze-job offers tailor-resume");
		assert.deepEqual(tailor?.args, {
			company: "Acme Corp",
			role: "Backend Engineer",
			postingText: (SAMPLE_CALLS["analyze-job"].args as { postingText: string }).postingText,
		});
		assert.equal(TailorCvInput.safeParse(tailor?.args).success, true);
		const letter = (analysis.actions ?? []).find((action) => action.tool === "generate-cover-letter");
		assert.ok(letter, "analyze-job offers generate-cover-letter");
		assert.equal(CoverInput.safeParse(letter?.args).success, true);

		const rank = mapToolToDashboard("rank-jobs", {}, SAMPLE_CALLS["rank-jobs"].structured, null);
		assert.equal(rank.items?.[0].action?.tool, "analyze-job");
		assert.equal(
			(rank.items?.[0].action?.args as { postingUrl?: string } | undefined)?.postingUrl,
			"https://example.com/jobs/1",
		);

		const search = mapToolToDashboard("search-jobs", {}, SAMPLE_CALLS["search-jobs"].structured, null);
		assert.equal(search.items?.[0].action?.tool, "analyze-job");

		const followups = mapToolToDashboard("due-followups", {}, SAMPLE_CALLS["due-followups"].structured, null);
		assert.equal(followups.items?.[0].action, undefined);
	});

	it("only offers tailor/letter buttons when the posting text is available", () => {
		// Analysis with posting text: both drafting buttons validate.
		const withText = mapToolToDashboard("analyze-job", SAMPLE_CALLS["analyze-job"].args, {}, null);
		for (const tool of ["tailor-resume", "generate-cover-letter"] as const) {
			const action = (withText.actions ?? []).find((entry) => entry.tool === tool);
			assert.ok(action, `${tool} offered with posting text`);
		}
		// Analysis without posting text: no drafting buttons rather than
		// calls that always fail input validation.
		const withoutText = mapToolToDashboard(
			"analyze-job",
			{ company: "Acme Corp", role: "Backend Engineer" },
			{},
			null,
		);
		assert.equal(
			(withoutText.actions ?? []).some((entry) =>
				["tailor-resume", "generate-cover-letter"].includes(entry.tool),
			),
			false,
		);
		// CV view reuses the tailor call's posting text for the letter button.
		const cv = mapToolToDashboard(
			"tailor-resume",
			SAMPLE_CALLS["tailor-resume"].args,
			SAMPLE_CALLS["tailor-resume"].structured,
			null,
		);
		const cvLetter = (cv.actions ?? []).find((entry) => entry.tool === "generate-cover-letter");
		assert.ok(cvLetter, "cv view offers the cover letter");
		assert.equal(CoverInput.safeParse(cvLetter?.args).success, true);
	});

	it("omits buttons whose required inputs the view cannot supply", () => {
		// Brief view: analyze runs on company+role; tailor needs posting
		// text the brief does not hold.
		const brief = mapToolToDashboard(
			"research-job",
			{ company: "Acme Corp", role: "Backend Engineer" },
			SAMPLE_CALLS["research-job"].structured,
			null,
		);
		assert.ok((brief.actions ?? []).some((entry) => entry.tool === "analyze-job"));
		assert.equal(
			(brief.actions ?? []).some((entry) => entry.tool === "tailor-resume"),
			false,
		);
		// Company research holds neither a target role nor posting text.
		const research = mapToolToDashboard(
			"research-company",
			{ company: "Acme Corp" },
			SAMPLE_CALLS["research-company"].structured,
			null,
		);
		assert.deepEqual(research.actions ?? [], []);
		// Strategy holds no postings for the rank backlog.
		const strategy = mapToolToDashboard(
			"career-strategy",
			{},
			SAMPLE_CALLS["career-strategy"].structured,
			null,
		);
		assert.equal(
			(strategy.actions ?? []).some((entry) => entry.tool === "rank-jobs"),
			false,
		);
		// Portal-answers input takes no company/role keys under strict
		// validation, so the interview button carries none and still validates.
		const interview = mapToolToDashboard(
			"prepare-interview",
			{},
			SAMPLE_CALLS["prepare-interview"].structured,
			null,
		);
		const answers = (interview.actions ?? []).find(
			(entry) => entry.tool === "draft-application-answers",
		);
		assert.ok(answers, "interview offers portal answers");
		assert.deepEqual(answers?.args, {});
		assert.equal(typeof answers?.args === "object", true);
	});

	it("degrades gracefully on empty or unknown payloads without guessing", () => {
		const empty = mapToolToDashboard("analyze-job", {}, null, null);
		assert.equal(empty.view, "analysis");
		assert.equal(empty.items?.length, 0);
		assert.equal(empty.markdown, undefined);

		const unknown = mapToolToDashboard("future-tool", { a: 1 }, { b: 2 }, "## Hello");
		assert.equal(unknown.title, "future-tool");
		assert.equal(unknown.markdown, "## Hello");
	});
});
