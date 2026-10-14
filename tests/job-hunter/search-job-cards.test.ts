import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { snippetFor } from "@/lib/job-hunter/search.ts";
import { SearchCandidateSchema, SearchJobsOutput } from "@/lib/job-hunter/schemas/search-jobs.ts";
import { mapToolToDashboard } from "@/mcp-app/toolviews.ts";
import type { DashboardItem } from "@/mcp-app/types.ts";

function structuredWith(candidates: unknown[]): Record<string, unknown> {
	return {
		filters: { keywords: "backend", location: "Berlin", limit: 10 },
		queries: [],
		candidates,
		staleCount: 0,
		queriesRun: ["backend"],
		nextCursor: null,
		notes: [],
		errors: [],
	};
}

function candidate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		key: "acme-corp_backend-engineer",
		title: "Backend Engineer",
		company: "Acme Corp",
		url: "https://example.com/jobs/1",
		postedDate: "2026-09-28",
		deadline: null,
		dateUnknown: false,
		status: "active",
		portal: "site",
		quickFit: { score: 78, band: "high", strengths: ["Python"], gaps: [], lowEvidence: false, textLength: 120 },
		language: { verdict: "PASS", note: "English posting." },
		consolidationNote: null,
		referralLinks: [],
		needsVerification: false,
		...overrides,
	};
}

describe("search snippet", () => {
	it("returns null when the adapter supplies no description", () => {
		assert.equal(snippetFor(undefined), null);
		assert.equal(snippetFor("   "), null);
	});

	it("collapses whitespace and caps long descriptions without inventing text", () => {
		assert.equal(snippetFor("Build\n  Python   APIs."), "Build Python APIs.");
		const long = `x`.repeat(500);
		const snippet = snippetFor(long);
		assert.ok(snippet !== null && snippet.length <= 281, "capped excerpt");
		assert.ok(snippet?.endsWith("…"), "truncation marked");
	});
});

describe("search candidate schema", () => {
	it("still accepts legacy payloads without display fields", () => {
		const parsed = SearchCandidateSchema.safeParse(candidate());
		assert.equal(parsed.success, true);
	});

	it("accepts adapter display fields and validates the full search output", () => {
		const parsed = SearchJobsOutput.safeParse(
			structuredWith([
				candidate({ snippet: "Build Python APIs.", location: "Berlin", remoteType: "remote" }),
			]),
		);
		assert.equal(parsed.success, true);
	});

	it("rejects invented shapes while allowing absent optionals", () => {
		assert.equal(SearchCandidateSchema.safeParse({ ...candidate(), remoteType: "teleport" }).success, false);
	});
});

describe("search job cards", () => {
	it("maps every result to Research job + Apply actions with the selected job's data", () => {
		const data = mapToolToDashboard("search-jobs", {}, structuredWith([candidate()]), null);
		const item = data.items?.[0] as DashboardItem | undefined;
		assert.ok(item, "one card mapped");
		assert.equal(item?.id, "acme-corp_backend-engineer");
		const labels = (item?.actions ?? []).map((action) => action.label);
		assert.deepEqual(labels, ["Research job", "Apply"]);
		const research = item?.actions?.[0];
		assert.equal(research?.tool, "research-job");
		assert.deepEqual(research?.args, { company: "Acme Corp", role: "Backend Engineer" });
		const apply = item?.actions?.[1];
		assert.equal(apply?.tool, "analyze-job");
		assert.deepEqual(apply?.args, {
			company: "Acme Corp",
			role: "Backend Engineer",
			postingUrl: "https://example.com/jobs/1",
		});
		// Backward compatibility: the primary single action stays the Apply entry point.
		assert.equal(item?.action?.tool, "analyze-job");
	});

	it("carries adapter display fields onto the card and omits the rest", () => {
		const data = mapToolToDashboard(
			"search-jobs",
			{},
			structuredWith([
				candidate({ snippet: "Own billing APIs.", location: "Berlin", remoteType: "remote" }),
			]),
			null,
		);
		const item = data.items?.[0] as DashboardItem | undefined;
		assert.equal(item?.description, "Own billing APIs.");
		assert.equal(item?.location, "Berlin");
		assert.equal(item?.remoteType, "remote");
		assert.equal(item?.source, "site");
		assert.equal(item?.postedAt, "2026-09-28");
		assert.equal(item?.status, "active");
		assert.equal(item?.employmentType, undefined);
		assert.equal(item?.salary, undefined);
		assert.equal(item?.companyLogo, undefined);
	});

	it("degrades gracefully when metadata is missing: no actions invented, no crash", () => {
		const data = mapToolToDashboard(
			"search-jobs",
			{},
			structuredWith([candidate({ company: "", title: "", url: "", snippet: null, location: null })]),
			null,
		);
		const item = data.items?.[0] as DashboardItem | undefined;
		assert.ok(item, "card still mapped");
		assert.equal(item?.description, undefined);
		assert.equal(item?.location, undefined);
		assert.deepEqual(item?.actions ?? [], []);
	});

	it("maps legacy candidates without display fields to working actions", () => {
		const { snippet: _dropped, location: _loc, remoteType: _remote, ...legacy } = candidate();
		const data = mapToolToDashboard("search-jobs", {}, structuredWith([legacy]), null);
		const item = data.items?.[0] as DashboardItem | undefined;
		assert.equal(item?.description, undefined);
		assert.equal((item?.actions ?? []).length, 2);
	});

	it("keeps the stable job key and listing URL available for downstream actions", () => {
		const data = mapToolToDashboard("search-jobs", {}, structuredWith([candidate()]), null);
		const item = data.items?.[0] as DashboardItem | undefined;
		assert.equal(item?.id, "acme-corp_backend-engineer");
		assert.equal(item?.url, "https://example.com/jobs/1");
	});

	it("returns an empty item list for empty searches so the view renders its empty state", () => {
		const data = mapToolToDashboard("search-jobs", {}, structuredWith([]), null);
		assert.deepEqual(data.items, []);
	});
});
