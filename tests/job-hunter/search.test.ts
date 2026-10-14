import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
	SEARCH_LIMIT_MAX,
	SEARCH_RECENCY_DAYS,
	buildAutoQueries,
	capLimit,
	isPeopleSearchUrl,
	planSearch,
	resolveSearchFilters,
} from "@/lib/job-hunter/search.ts";
import type { RawPosting } from "@/lib/job-hunter/search.ts";
import type { Profile } from "@/lib/job-hunter/profile.ts";

const PROFILE: Profile = {
	name: "Test Candidate",
	location: "Test City, Test Country",
	workCountry: "Test Country",
	permitClasses: [],
	languages: [{ language: "English", level: "C1" }],
	preferences: { targetRoles: ["ML Engineer"] },
	skills: [{ name: "Python", category: "primary" as const }, { name: "SQL", category: "primary" as const }, { name: "Docker", category: "secondary" as const }],
	domains: [{ name: "fraud detection", category: "strong" as const }, { name: "credit risk", category: "adjacent" as const }],
	energizingTasks: ["model building"],
	drainingTasks: [],
};

function posting(overrides: Partial<RawPosting> = {}): RawPosting {
	return {
		title: "ML Engineer",
		company: "Acme",
		url: "https://example.com/jobs/1",
		description: "Python and SQL for fraud detection.",
		postedDate: "2026-09-20",
		...overrides,
	};
}

describe("capLimit", () => {
	it("caps the limit at 20 and defaults to 10", () => {
		assert.equal(capLimit(50), SEARCH_LIMIT_MAX);
		assert.equal(capLimit(undefined), 10);
		assert.equal(capLimit(5), 5);
	});
});

describe("resolveSearchFilters", () => {
	it("keeps explicit filters when given", () => {
		const filters = resolveSearchFilters({ keywords: "Python", location: "Berlin, Germany" }, PROFILE);
		assert.equal(filters.keywords, "Python");
		assert.equal(filters.location, "Berlin, Germany");
	});

	it("derives the location from the profile when absent", () => {
		const filters = resolveSearchFilters({ keywords: "Python" }, PROFILE);
		assert.equal(filters.location, PROFILE.location);
	});
});

describe("buildAutoQueries", () => {
	it("builds per-language function-based categories from the profile", () => {
		const queries = buildAutoQueries(PROFILE);
		assert.ok(queries.length > 0, "expected at least one auto query");
		for (const query of queries) {
			assert.ok(query.category.length >= 2, "function-based category");
			assert.ok(query.language.length >= 2, "per-language rendering");
			assert.ok(query.query.length >= 2, "usable query text");
		}
		assert.ok(
			queries.some((query) => query.query.includes("Python")),
			"profile skills feed the auto query",
		);
	});
});

describe("isPeopleSearchUrl", () => {	it("refuses LinkedIn people-search pages", () => {
		assert.equal(isPeopleSearchUrl("https://www.linkedin.com/in/jane-smith"), true);
		assert.equal(isPeopleSearchUrl("https://www.linkedin.com/search/results/people/?keywords=Acme"), true);
		assert.equal(isPeopleSearchUrl("https://www.linkedin.com/jobs/view/123"), false);
	});
});

describe("planSearch", () => {
	it("errors honestly when no source can run instead of fabricating postings", async () => {
		const plan = await planSearch({ profile: PROFILE });
		assert.deepEqual(plan.candidates, []);
		assert.ok(plan.errors.length > 0, "expected an explicit no-source error");
	});

	it("requires scraper adapters to run instead of fabricating postings", async () => {
		const plan = await planSearch({ profile: PROFILE, scraperAdapters: [] });
		assert.deepEqual(plan.candidates, []);
		assert.ok(plan.errors.some((error) => error.includes("No search source available")));
	});

	it("plans scraper results with stability-ready canonical keys", async () => {
		const plan = await planSearch({
			profile: PROFILE,
			scraperAdapters: ["test"],
			scraperFetch: async () => [posting()],
			now: new Date("2026-09-29T00:00:00Z"),
		});
		assert.equal(plan.candidates.length, 1);
		assert.match(plan.candidates[0].key, /^[a-z0-9][a-z0-9-]*_[a-z0-9][a-z0-9-]*$/);
		assert.equal(plan.candidates[0].portal, "linkedin");
	});

	it("flags unknown dates instead of dropping the posting", async () => {
		const plan = await planSearch({
			profile: PROFILE,
			scraperAdapters: ["test"],
			scraperFetch: async () => [posting({ postedDate: undefined, deadline: undefined })],
			now: new Date("2026-09-29T00:00:00Z"),
		});
		assert.equal(plan.candidates.length, 1);
		assert.equal(plan.candidates[0].dateUnknown, true);
	});

	it("excludes stale postings outside the 14-day window and reports the count", async () => {
		const plan = await planSearch({
			profile: PROFILE,
			scraperAdapters: ["test"],
			scraperFetch: async () => [posting({ postedDate: "2026-01-01" })],
			now: new Date("2026-09-29T00:00:00Z"),
		});
		assert.deepEqual(plan.candidates, []);
		assert.equal(plan.staleCount, 1);
		assert.equal(SEARCH_RECENCY_DAYS, 14);
	});

	it("keeps expired postings as ghosts, never silently dropped", async () => {
		const plan = await planSearch({
			profile: PROFILE,
			scraperAdapters: ["test"],
			scraperFetch: async () => [posting({ deadline: "2026-01-01" })],
			now: new Date("2026-09-29T00:00:00Z"),
		});
		assert.equal(plan.candidates.length, 1);
		assert.equal(plan.candidates[0].status, "expired");
	});

	it("overrides quick-fit on a language-gate FAIL and flags without veto", async () => {
		const germanPosting = posting({
			description: "Danish is required for this role. Python and SQL for fraud detection.",
		});
		const plan = await planSearch({
			profile: PROFILE,
			scraperAdapters: ["test"],
			scraperFetch: async () => [germanPosting],
			now: new Date("2026-09-29T00:00:00Z"),
		});
		assert.equal(plan.candidates[0].quickFit.band, "low");
		assert.ok(plan.candidates[0].language.note.includes("Danish"));
		assert.deepEqual(plan.candidates[0].referralLinks, [], "no referral links for low fits");
	});

	it("adds referral links for high and medium fits only", async () => {
		const plan = await planSearch({
			profile: PROFILE,
			scraperAdapters: ["test"],
			scraperFetch: async () => [posting()],
			now: new Date("2026-09-29T00:00:00Z"),
		});
		const band = plan.candidates[0].quickFit.band;
		if (band === "high" || band === "medium") {
			assert.ok(plan.candidates[0].referralLinks.length > 0, "referral links for promising fits");
		} else {
			assert.deepEqual(plan.candidates[0].referralLinks, []);
		}
	});

	it("aggregates every auto-query into one merged list", async () => {
		const multiProfile: Profile = {
			...PROFILE,
			preferences: { targetRoles: ["ML Engineer", "Data Engineer", "Platform Engineer"] },
		};
		const seenQueries: string[] = [];
		const plan = await planSearch({
			profile: multiProfile,
			scraperAdapters: ["test"],
			scraperFetch: async (query: string) => {
				seenQueries.push(query);
				const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, "-");
				return [posting({ title: `Role for ${query}`, url: `https://example.com/jobs/${slug}` })];
			},
			filters: { limit: 20 },
			now: new Date("2026-09-29T00:00:00Z"),
		});
		assert.ok(seenQueries.length > 3, `expected more queries than the old cap of 3, ran ${seenQueries.length}`);
		assert.deepEqual(plan.queriesRun, seenQueries);
		assert.equal(plan.candidates.length, seenQueries.length);
		assert.ok(
			plan.notes.every((note) => !note.includes("Query coverage")),
			"no partial-coverage note when every query runs",
		);
	});

	it("consolidates mass postings with an explicit note", async () => {
		const plan = await planSearch({
			profile: PROFILE,
			scraperAdapters: ["test"],
			scraperFetch: async () => [
				posting({ url: "https://example.com/jobs/1" }),
				posting({ url: "https://example.com/jobs/2" }),
			],
			now: new Date("2026-09-29T00:00:00Z"),
		});
		assert.equal(plan.candidates.length, 1);
		assert.ok(
			(plan.candidates[0].consolidationNote ?? "").includes("2"),
			"expected a mass-posting consolidation note",
		);
	});

	it("strips URL fragments so keys stay stable", async () => {
		const plan = await planSearch({
			profile: PROFILE,
			scraperAdapters: ["test"],
			scraperFetch: async () => [posting({ url: "https://example.com/jobs/1#apply" })],
			now: new Date("2026-09-29T00:00:00Z"),
		});
		assert.equal(plan.candidates[0].url, "https://example.com/jobs/1");
	});
});
